from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..core.security import CurrentUser, get_current_user
from ..services import sheet_bridge
from ..services.audit import audit

router = APIRouter(prefix="/api/templates", tags=["templates"])

COLUMNS = (
    "id,department,source_id,tab_id,source_name,spreadsheet_id,sheet_name,sheet_gid,source_ref,kind,name,campaign,"
    "specialty,subject,body_html,is_active,notes,subject_cell,body_cell,active_cell,sort_order,last_synced_at,"
    "updated_at,updated_by_email"
)
UUID_RE = re.compile(r"^[0-9a-f-]{36}$")


async def _target(user: CurrentUser, spreadsheet_id: str) -> dict | None:
    rows = await user.db().rpc("sheet_write_target", {"p_spreadsheet": spreadsheet_id})
    return rows[0] if rows else None


async def _get(user: CurrentUser, template_id: str) -> dict:
    if not UUID_RE.match(template_id):
        raise HTTPException(400, "Invalid template id")
    rows, _ = await user.db().select("email_templates", {"id": f"eq.{template_id}", "select": COLUMNS})
    if not rows:
        raise HTTPException(404, "Template not found")
    return rows[0]


def _bridge_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, sheet_bridge.BridgeNotConnected):
        return HTTPException(409, str(exc))
    return HTTPException(502, str(exc))


@router.get("")
async def list_templates(department: str | None = None, user: CurrentUser = Depends(get_current_user)):
    departments = user.ensure_department(department)
    rows = await user.db().select_all("email_templates", [
        ("department", f"in.({','.join(departments)})"),
        ("select", COLUMNS),
        ("order", "department,source_name,sheet_name,sort_order"),
    ])
    editable: dict[str, bool] = {}
    for sid in sorted({r["spreadsheet_id"] for r in rows}):
        target = await _target(user, sid)
        editable[sid] = bool(target and target.get("bridge_url"))
    return {"items": rows, "editable": editable}


@router.get("/{template_id}")
async def get_template(template_id: str, user: CurrentUser = Depends(get_current_user)):
    t = await _get(user, template_id)
    target = await _target(user, t["spreadsheet_id"])
    return {**t, "editable": bool(target and target.get("bridge_url"))}


class TemplateUpdate(BaseModel):
    subject: str | None = Field(None, max_length=1000)
    body_html: str | None = Field(None, max_length=48000)
    is_active: bool | None = None


@router.put("/{template_id}")
async def update_template(template_id: str, body: TemplateUpdate, request: Request,
                          user: CurrentUser = Depends(get_current_user)):
    t = await _get(user, template_id)
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(400, "Nothing to update")
    updates = []
    for field, cell_key in (("subject", "subject_cell"), ("body_html", "body_cell")):
        if field in changes:
            if not t.get(cell_key):
                raise HTTPException(400, f"This template has no {field.replace('_html', '')} to edit")
            updates.append({"sheet": t["sheet_name"], "cell": t[cell_key], "value": changes[field]})
    if "is_active" in changes:
        if not t.get("active_cell"):
            raise HTTPException(400, "This template has no Active column")
        updates.append({"sheet": t["sheet_name"], "cell": t["active_cell"], "value": "yes" if changes["is_active"] else "no"})
    try:
        await sheet_bridge.update_cells(await _target(user, t["spreadsheet_id"]), updates)
    except (sheet_bridge.BridgeError, sheet_bridge.BridgeNotConnected) as exc:
        raise _bridge_errors(exc)
    rows = await user.db().update("email_templates", [("id", f"eq.{template_id}")], {
        **changes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": user.id,
        "updated_by_email": user.email,
    }, returning=COLUMNS)
    await audit("Template updated", user, "email_template", template_id,
                {"name": t["name"], "sheet": t["sheet_name"], "fields": sorted(changes)}, request)
    return rows[0] if rows else t


class NewSubjectLine(BaseModel):
    tab_id: int
    subject: str = Field(min_length=1, max_length=300)


@router.post("/subject-lines")
async def add_subject_line(body: NewSubjectLine, request: Request, user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("email_templates", [
        ("tab_id", f"eq.{body.tab_id}"), ("kind", "eq.subject_line"), ("select", COLUMNS), ("order", "sort_order"),
    ])
    if not rows:
        raise HTTPException(404, "Subject line list not found. Run a sync first.")
    first = rows[0]
    try:
        row_no = await sheet_bridge.append_row(await _target(user, first["spreadsheet_id"]), first["sheet_name"], [body.subject])
    except (sheet_bridge.BridgeError, sheet_bridge.BridgeNotConnected) as exc:
        raise _bridge_errors(exc)
    column = re.match(r"[A-Za-z]+", first["subject_cell"] or "A").group(0)
    created = await user.db().insert("email_templates", {
        "department": first["department"], "source_id": first["source_id"], "tab_id": first["tab_id"],
        "source_name": first["source_name"], "spreadsheet_id": first["spreadsheet_id"],
        "sheet_name": first["sheet_name"], "sheet_gid": first["sheet_gid"], "source_ref": f"row:{row_no}",
        "kind": "subject_line", "name": f"Subject line {len(rows) + 1}", "subject": body.subject,
        "subject_cell": f"{column}{row_no}", "notes": first["notes"], "sort_order": row_no,
        "updated_by": user.id, "updated_by_email": user.email,
    }, on_conflict="spreadsheet_id,sheet_name,source_ref", resolution="merge-duplicates", returning=COLUMNS)
    await audit("Template updated", user, "email_template", created[0]["id"] if created else None,
                {"sheet": first["sheet_name"], "action": "subject line added"}, request)
    return created[0] if created else {}


@router.delete("/{template_id}")
async def delete_subject_line(template_id: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    t = await _get(user, template_id)
    if t["kind"] != "subject_line":
        raise HTTPException(400, "Only subject lines can be deleted from the dashboard")
    row_no = int(t["source_ref"].split(":")[1])
    try:
        await sheet_bridge.delete_row(await _target(user, t["spreadsheet_id"]), t["sheet_name"], row_no)
    except (sheet_bridge.BridgeError, sheet_bridge.BridgeNotConnected) as exc:
        raise _bridge_errors(exc)
    db = user.db()
    await db.delete("email_templates", [("id", f"eq.{template_id}")])
    # Rows below the deleted one moved up by one in the sheet.
    later, _ = await db.select("email_templates", [
        ("tab_id", f"eq.{t['tab_id']}"), ("kind", "eq.subject_line"), ("select", "id,sort_order,subject_cell"),
        ("order", "sort_order"),
    ])
    column = re.match(r"[A-Za-z]+", t["subject_cell"] or "A").group(0)
    for n, row in enumerate(later, start=1):
        new_row = row["sort_order"] - 1 if row["sort_order"] > row_no else row["sort_order"]
        await db.update("email_templates", [("id", f"eq.{row['id']}")], {
            "sort_order": new_row, "source_ref": f"row:{new_row}", "subject_cell": f"{column}{new_row}",
            "name": f"Subject line {n}",
        })
    await audit("Template updated", user, "email_template", template_id,
                {"sheet": t["sheet_name"], "action": "subject line deleted", "subject": t["subject"]}, request)
    return {"ok": True}
