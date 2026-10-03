from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..core.config import get_settings
from ..core.security import CurrentUser, require_admin
from ..core.supabase import ServiceUnavailable, SupabaseError
from ..services.audit import audit
from ..services import sheet_bridge
from ..services.google_sheets_service import SheetReadError
from ..services.sync_service import run_sync

router = APIRouter(prefix="/api", tags=["google-sheets"])


@router.get("/google-sheets")
async def list_connections(user: CurrentUser = Depends(require_admin)):
    db = user.db()
    sources, _ = await db.select("google_sheet_sources", {
        "select": "id,name,spreadsheet_id,default_department,description,is_active,access_mode,write_bridge_url",
        "order": "id",
    })
    tabs, _ = await db.select("google_sheet_tabs", {"select": "*", "order": "source_id,id"})
    s = get_settings()
    return {
        "sources": [{**src, "tabs": [t for t in tabs if t["source_id"] == src["id"]]} for src in sources],
        "google_service_account": s.google_client_email or None,
        "service_role_configured": s.has_service_role,
        "scheduled_sync_available": s.has_service_role and bool(s.cron_secret),
    }


@router.get("/google-sheets/sync-history")
async def sync_history(user: CurrentUser = Depends(require_admin)):
    rows, _ = await user.db().select("google_sheet_sync_logs", {"select": "*", "order": "started_at.desc", "limit": "30"})
    return rows


async def _sync(user: CurrentUser | None, trigger: str, request: Request | None):
    try:
        result = await run_sync(user, trigger)
    except ServiceUnavailable as exc:
        raise HTTPException(503, str(exc))
    except (SupabaseError, SheetReadError) as exc:
        raise HTTPException(502, f"Sync failed: {exc}")
    await audit("Google Sheet synced", user, "google_sheets", str(result.get("log_id")),
                {k: result[k] for k in ("status", "new", "updated", "unchanged", "duplicates", "errors")}, request)
    return result


@router.post("/google-sheets/sync")
async def sync_now(request: Request, user: CurrentUser = Depends(require_admin)):
    return await _sync(user, "manual", request)


@router.get("/cron/sync")
async def cron_sync(request: Request):
    """Scheduled sync. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`."""
    secret = get_settings().cron_secret
    header = request.headers.get("authorization", "")
    if not secret or not hmac.compare_digest(header, f"Bearer {secret}"):
        raise HTTPException(401, "Unauthorized")
    return await _sync(None, "scheduled", request)


class TabUpdate(BaseModel):
    data_kind: str | None = Field(None, pattern="^(doctors|feedback|templates|ignore)$")
    department_code: str | None = Field(None, pattern="^(NPP|RARE_DISEASES)$")
    sub_department: str | None = Field(None, max_length=120)
    specialty: str | None = Field(None, max_length=120)
    is_enabled: bool | None = None
    sheet_gid: int | None = None
    mapping: dict | None = None


@router.put("/google-sheets/tabs/{tab_id}")
async def update_tab(tab_id: int, body: TabUpdate, request: Request, user: CurrentUser = Depends(require_admin)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "Nothing to update")
    rows = await user.db().update("google_sheet_tabs", [("id", f"eq.{tab_id}")], changes, returning="*")
    if not rows:
        raise HTTPException(404, "Tab not found")
    await audit("Settings changed", user, "google_sheet_tab", str(tab_id), changes, request)
    return rows[0]


# --------------------------------------------------------------------------- dashboard editing bridge

async def _source(user: CurrentUser, source_id: int) -> dict:
    rows, _ = await user.db().select("google_sheet_sources", {"id": f"eq.{source_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Spreadsheet not found")
    return rows[0]


async def _template_tabs(user: CurrentUser, source_id: int) -> list[str]:
    tabs, _ = await user.db().select("google_sheet_tabs", {
        "source_id": f"eq.{source_id}", "data_kind": "eq.templates", "select": "tab_name", "order": "id",
    })
    return [t["tab_name"] for t in tabs]


@router.get("/google-sheets/sources/{source_id}/editing")
async def editing_setup(source_id: int, user: CurrentUser = Depends(require_admin)):
    src = await _source(user, source_id)
    tabs = await _template_tabs(user, source_id)
    if not tabs:
        raise HTTPException(400, "This spreadsheet has no template tabs to edit")
    token = src.get("write_bridge_token")
    if not token:
        token = sheet_bridge.new_token()
        await user.db().update("google_sheet_sources", [("id", f"eq.{source_id}")], {"write_bridge_token": token})
    return {
        "connected": bool(src.get("write_bridge_url")),
        "url": src.get("write_bridge_url"),
        "tabs": tabs,
        "script": sheet_bridge.render_script(src["spreadsheet_id"], src["name"], token, tabs),
    }


class EditingUrl(BaseModel):
    url: str = Field(max_length=300)


@router.put("/google-sheets/sources/{source_id}/editing")
async def connect_editing(source_id: int, body: EditingUrl, request: Request, user: CurrentUser = Depends(require_admin)):
    url = body.url.strip()
    if not sheet_bridge.valid_url(url):
        raise HTTPException(400, "Paste the Web app URL that ends with /exec (https://script.google.com/macros/s/…/exec)")
    src = await _source(user, source_id)
    if not src.get("write_bridge_token"):
        raise HTTPException(400, "Open the setup first to get the script")
    try:
        data = await sheet_bridge.call(url, src["write_bridge_token"], {"action": "ping"})
    except sheet_bridge.BridgeError as exc:
        raise HTTPException(502, str(exc))
    await user.db().update("google_sheet_sources", [("id", f"eq.{source_id}")], {"write_bridge_url": url})
    await audit("Settings changed", user, "google_sheet_source", str(source_id), {"dashboard_editing": "connected"}, request)
    return {"connected": True, "spreadsheet_name": data.get("name"), "tabs": data.get("tabs")}


@router.delete("/google-sheets/sources/{source_id}/editing")
async def disconnect_editing(source_id: int, request: Request, user: CurrentUser = Depends(require_admin)):
    await user.db().update("google_sheet_sources", [("id", f"eq.{source_id}")],
                           {"write_bridge_url": None, "write_bridge_token": None})
    await audit("Settings changed", user, "google_sheet_source", str(source_id), {"dashboard_editing": "disconnected"}, request)
    return {"connected": False}
