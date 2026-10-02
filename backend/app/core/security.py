"""Authentication, role checks and rate limiting.

Every protected endpoint resolves the caller from their Supabase JWT and
loads their profile *with their own token*, so the role comes from the same
RLS-protected row the database itself trusts. Department checks happen here
(FastAPI) and again in Postgres RLS.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from .config import get_settings
from .supabase import PostgREST, ServiceUnavailable, auth_get_user

DEPARTMENTS = ("NPP", "RARE_DISEASES")
ROLES = ("ADMIN", "NPP", "RARE_DISEASES")


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str | None
    role: str
    token: str

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"

    @property
    def departments(self) -> list[str]:
        return list(DEPARTMENTS) if self.is_admin else [self.role]

    def db(self) -> PostgREST:
        """PostgREST client acting as this user (RLS enforced)."""
        return PostgREST(token=self.token)

    def ensure_department(self, department: str | None) -> list[str]:
        """Departments a query may touch. Raises 403 for a forbidden department."""
        if department:
            if department not in DEPARTMENTS:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown department")
            if department not in self.departments:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this department")
            return [department]
        return self.departments


_token_cache: dict[str, tuple[float, CurrentUser]] = {}
_CACHE_SECONDS = 60


async def get_current_user(request: Request) -> CurrentUser:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    token = header.split(" ", 1)[1].strip()

    cached = _token_cache.get(token)
    if cached and cached[0] > time.time():
        return cached[1]

    try:
        auth_user = await auth_get_user(token)
    except ServiceUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if not auth_user or not auth_user.get("id"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")

    rows, _ = await PostgREST(token=token).select(
        "profiles", {"id": f"eq.{auth_user['id']}", "select": "id,email,name,role,status"}
    )
    profile = rows[0] if rows else None
    if not profile or profile.get("status") != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is disabled. Contact an administrator.")
    if profile.get("role") not in ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No role has been assigned to your account yet.")

    user = CurrentUser(
        id=profile["id"], email=profile["email"], name=profile.get("name"), role=profile["role"], token=token
    )
    if len(_token_cache) > 2000:
        _token_cache.clear()
    _token_cache[token] = (time.time() + _CACHE_SECONDS, user)
    return user


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Sliding-window limiter per client IP. Best effort: serverless
    instances do not share memory, so this caps bursts per instance."""

    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        limit = get_settings().rate_limit_per_minute
        now = time.time()
        q = self.hits[key]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        if len(self.hits) > 10000:
            self.hits.clear()
        return True


rate_limiter = RateLimiter()
