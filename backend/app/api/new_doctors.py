"""New Doctors (Apollo leads). Isolated from the main doctor directory."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ..core.config import get_settings
from ..core.security import CurrentUser, get_current_user
from ..core.supabase import PostgREST, SupabaseError
from ..services import new_doctors_service as svc
from ..services.audit import audit
from ..services.google_sheets_service import SheetReadError

router = APIRouter(prefix="/api/new-doctors", tags=["new-doctors"])

COLUMNS = ("id,sheet_row,doctor_name,specialty,sub_department,hospital,city,email,status,"
           "sent_at,sent_date_raw,subject_used,error,follow_up,thread_id,extra,synced_at")


def _check(user: CurrentUser) -> None:
    if "NPP" not in user.departments:
        raise HTTPException(403, "New Doctors is available to Admin and NPP users")


@router.get("")
async def list_new_doctors(user: CurrentUser = Depends(get_current_user)):
    _check(user)
    rows = await user.db().select_all(svc.TABLE, [("select", COLUMNS), ("order", "sent_at.desc.nullslast,sheet_row.asc")])
    return {"items": rows, "summary": svc.summarize(rows)}


@router.post("/sync")
async def sync_new_doctors(request: Request, user: CurrentUser = Depends(get_current_user)):
    _check(user)
    db = PostgREST.service() if get_settings().has_service_role else user.db()
    try:
        result = await svc.sync(db)
    except SheetReadError as exc:
        raise HTTPException(502, str(exc))
    except SupabaseError as exc:
        raise HTTPException(502, f"Sync failed: {exc.message}")
    await audit("New Doctors sheet synced", user, "new_doctors", None,
                {k: result[k] for k in ("rows", "added", "updated", "removed")}, request)
    return result
