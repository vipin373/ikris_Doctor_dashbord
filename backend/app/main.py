from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import core, doctors, google_sheets
from .core.config import get_settings
from .core.security import client_ip, rate_limiter
from .core.supabase import ServiceUnavailable, SupabaseError

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="IKRIS Doctor Connect API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def limit_and_secure(request: Request, call_next):
    if request.url.path.startswith("/api/") and not rate_limiter.allow(client_ip(request)):
        return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(SupabaseError)
async def supabase_error(_: Request, exc: SupabaseError):
    status = exc.status if exc.status in (400, 401, 403, 404, 409) else 502
    return JSONResponse({"detail": exc.message}, status_code=status)


@app.exception_handler(ServiceUnavailable)
async def service_unavailable(_: Request, exc: ServiceUnavailable):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse({"detail": "Invalid request", "errors": exc.errors()}, status_code=422)


@app.get("/api/health")
async def health():
    s = get_settings()
    return {
        "status": "ok",
        "supabase": bool(s.supabase_url and s.supabase_anon_key),
        "service_role": s.has_service_role,
        "google_service_account": s.has_google_service_account,
    }


app.include_router(core.router)
app.include_router(doctors.router)
app.include_router(google_sheets.router)

_ = HTTPException
