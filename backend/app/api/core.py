from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field

from ..core.config import get_settings
from ..core.security import ROLES, CurrentUser, get_current_user, require_admin
from ..core.supabase import PostgREST, ServiceUnavailable, SupabaseError, auth_invite_user
from ..services.audit import audit

router = APIRouter(prefix="/api", tags=["core"])


# --------------------------------------------------------------------------- me / session

@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "departments": user.departments}


@router.post("/auth/session-event")
async def session_event(event: str = Query(..., pattern="^(login|logout)$"), request: Request = None,
                        user: CurrentUser = Depends(get_current_user)):
    if event == "login":
        try:
            await PostgREST.service().update("profiles", [("id", f"eq.{user.id}")],
                                             {"last_login": datetime.now(timezone.utc).isoformat()})
        except (ServiceUnavailable, SupabaseError):
            pass
    await audit("Login" if event == "login" else "Logout", user, "session", request=request)
    return {"ok": True}


# --------------------------------------------------------------------------- dashboard

@router.get("/dashboard/summary")
async def dashboard_summary(user: CurrentUser = Depends(get_current_user)):
    data = await user.db().rpc("dashboard_summary")
    data["role"] = user.role
    return data


# --------------------------------------------------------------------------- patient feedback

FEEDBACK_COLUMNS = (
    "id,department,division,patient_name,country_code,phone_number,medicine,request_date,sent_date,"
    "whatsapp_status,status,rating,feedback,follow_up_required,review_link,data_issues,source_row_number"
)


@router.get("/feedback")
async def list_feedback(
    q: str | None = None,
    department: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
):
    departments = user.ensure_department(department)
    params: list[tuple[str, str]] = [
        ("department", f"in.({','.join(departments)})"),
        ("select", FEEDBACK_COLUMNS),
        ("order", "request_date.desc.nullslast,source_row_number.desc"),
    ]
    if status:
        params.append(("whatsapp_status", "is.null" if status == "Pending" else f"eq.{status}"))
    if q:
        term = "".join(ch for ch in q if ch.isalnum() or ch in " .-@").strip()
        if term:
            params.append(("or", f'(patient_name.ilike."*{term}*",medicine.ilike."*{term}*",phone_number.ilike."*{term}*")'))
    rows, total = await user.db().select("patient_feedback", params, count=True,
                                         offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/feedback/summary")
async def feedback_summary(user: CurrentUser = Depends(get_current_user)):
    rows = await user.db().select_all("patient_feedback", [
        ("select", "department,division,whatsapp_status,medicine,rating,follow_up_required,request_date"),
    ])
    by_status: dict[str, int] = {}
    by_division: dict[str, int] = {}
    by_medicine: dict[str, int] = {}
    by_month: dict[str, int] = {}
    ratings: dict[str, int] = {}
    for r in rows:
        by_status[r["whatsapp_status"] or "Pending"] = by_status.get(r["whatsapp_status"] or "Pending", 0) + 1
        by_division[r["division"] or "Unknown"] = by_division.get(r["division"] or "Unknown", 0) + 1
        med = (r["medicine"] or "Unknown").split("(")[0].strip().title()[:30]
        med = med.replace(" 50 Mg", "").replace(" 150 Mg", "").replace(" 50Mg", "").replace(" 150Mg", "")
        by_medicine[med] = by_medicine.get(med, 0) + 1
        if r["request_date"]:
            by_month[r["request_date"][:7]] = by_month.get(r["request_date"][:7], 0) + 1
        if r["rating"]:
            ratings[str(r["rating"])] = ratings.get(str(r["rating"]), 0) + 1
    top_meds = sorted(by_medicine.items(), key=lambda kv: -kv[1])[:8]
    return {
        "total": len(rows),
        "by_status": by_status,
        "by_division": by_division,
        "top_medicines": [{"medicine": k, "count": v} for k, v in top_meds],
        "by_month": [{"month": k, "count": v} for k, v in sorted(by_month.items())],
        "ratings": ratings,
        "follow_up_required": sum(1 for r in rows if r["follow_up_required"]),
    }


# --------------------------------------------------------------------------- users (Admin)

class InviteUser(BaseModel):
    email: EmailStr
    name: str | None = Field(None, max_length=120)
    role: str = Field(pattern="^(ADMIN|NPP|RARE_DISEASES)$")


class UpdateUser(BaseModel):
    role: str | None = Field(None, pattern="^(ADMIN|NPP|RARE_DISEASES)$")
    status: str | None = Field(None, pattern="^(active|disabled)$")
    name: str | None = Field(None, max_length=120)


@router.get("/users")
async def list_users(user: CurrentUser = Depends(require_admin)):
    rows, _ = await user.db().select("profiles", {
        "select": "id,email,name,role,status,created_at,last_login", "order": "created_at.asc",
    })
    return {"items": rows, "can_invite": get_settings().has_service_role}


@router.post("/users")
async def invite_user(body: InviteUser, request: Request, user: CurrentUser = Depends(require_admin)):
    settings = get_settings()
    redirect = f"{settings.app_url}/reset-password" if settings.app_url else None
    try:
        invited = await auth_invite_user(body.email, body.name, redirect)
    except ServiceUnavailable as exc:
        raise HTTPException(503, str(exc))
    except SupabaseError as exc:
        raise HTTPException(400, exc.message)
    uid = invited.get("id")
    if uid:
        await PostgREST.service().update("profiles", [("id", f"eq.{uid}")], {"role": body.role, "name": body.name})
    await audit("User created", user, "user", uid, {"email": body.email, "role": body.role}, request)
    return {"id": uid, "email": body.email, "role": body.role}


@router.put("/users/{user_id}")
async def update_user(user_id: str, body: UpdateUser, request: Request, user: CurrentUser = Depends(require_admin)):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(400, "Nothing to update")
    if user_id == user.id and (changes.get("role", "ADMIN") != "ADMIN" or changes.get("status") == "disabled"):
        raise HTTPException(400, "You cannot remove your own administrator access")
    rows = await user.db().update("profiles", [("id", f"eq.{user_id}")], changes, returning="id,email,role,status,name")
    if not rows:
        raise HTTPException(404, "User not found")
    action = "Permission changed" if "role" in changes or "status" in changes else "User updated"
    await audit(action, user, "user", user_id, changes, request)
    return rows[0]


# --------------------------------------------------------------------------- audit logs (Admin)

@router.get("/audit-logs")
async def audit_logs(
    action: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(require_admin),
):
    params: list[tuple[str, str]] = [("select", "*"), ("order", "created_at.desc")]
    if action:
        params.append(("action", f"eq.{action}"))
    rows, total = await user.db().select("audit_logs", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/departments")
async def departments(user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("departments", {"select": "code,name", "order": "sort_order"})
    return rows


_ = (ROLES, timedelta)
