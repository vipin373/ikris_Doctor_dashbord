from __future__ import annotations

import logging
from typing import Any

from fastapi import Request

from ..core.security import CurrentUser, client_ip
from ..core.supabase import PostgREST, ServiceUnavailable, SupabaseError

log = logging.getLogger("audit")


async def audit(
    action: str,
    user: CurrentUser | None = None,
    entity: str | None = None,
    entity_id: str | None = None,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Write an audit log row. Never breaks the calling request."""
    try:
        await PostgREST.service().insert("audit_logs", {
            "user_id": user.id if user else None,
            "user_email": user.email if user else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "details": details or {},
            "ip": client_ip(request) if request else None,
        })
    except (ServiceUnavailable, SupabaseError) as exc:
        log.warning("audit log skipped (%s): %s", action, exc)
