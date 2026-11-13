"""NPP Doctor CRM: categories (A / B / C / blank), category board, bulk updates,
category import, doctor groups, outreach campaigns, reply inbox and analytics.

Rules
- A doctor's category is only ever A, B, C or blank (NULL). It is never defaulted or inferred.
- Category changes go through the `set_doctor_categories` database function, which checks
  the user's role, writes all rows in one transaction and logs every change.
- Everything here is NPP-only.
"""

from __future__ import annotations

import csv
import html
import io
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core.config import get_settings
from ..core.security import CurrentUser, get_current_user
from ..core.supabase import PostgREST, SupabaseError
from ..services import email_service, whatsapp_service
from ..services.audit import audit
from ..services.whatsapp_service import ProviderNotConfigured
from .doctors import build_filters

router = APIRouter(prefix="/api/npp", tags=["npp-crm"])

DEPT = "NPP"
CATS = ("A", "B", "C")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
CARD_COLUMNS = ("id,doctor_name,specialty,sub_department,institute,city,state,country,email,email_norm,"
                "whatsapp_number,category,emails_sent,whatsapp_sent,last_contact_at,email_reply_status,whatsapp_reply_status")
SEND_BATCH = 25  # messages sent per request; the screen calls /continue until done


def npp_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if DEPT not in user.departments:
        raise HTTPException(403, "The NPP CRM is available to Admin and NPP users")
    return user


def _uuid_list(ids: list[str]) -> list[str]:
    bad = [i for i in ids if not UUID_RE.match(i)]
    if bad:
        raise HTTPException(400, f"Invalid doctor id: {bad[0]}")
    return list(dict.fromkeys(ids))


class DoctorFilters(BaseModel):
    """Same filters as the doctor list. Department is always NPP here."""
    q: str | None = None
    sub_department: str | None = None
    specialty: str | None = None
    category: str | None = Field(None, pattern="^([ABC]|none)$")
    city: str | None = None
    state: str | None = None
    institute: str | None = Field(None, max_length=120)
    bdm: str | None = None
    nsm: str | None = None
    has_email: bool | None = None
    has_phone: bool | None = None
    has_whatsapp: bool | None = None
    contact: str | None = None
    reply: str | None = Field(None, pattern="^(replied|auto|any|none|email|whatsapp)$")
    data_issue: str | None = None


def _filter_params(user: CurrentUser, f: DoctorFilters) -> list[tuple[str, str]]:
    d = f.model_dump()
    return build_filters(user, department=DEPT, **d)


async def _resolve_ids(user: CurrentUser, doctor_ids: list[str] | None, filters: DoctorFilters | None,
                       limit: int = 5000) -> list[str]:
    """Explicit selection, or the WHOLE filtered list (not just the visible page)."""
    if doctor_ids:
        return _uuid_list(doctor_ids)
    if filters is None:
        raise HTTPException(400, "Select doctors or apply filters")
    rows = await user.db().select_all("doctors", _filter_params(user, filters) + [("select", "id"), ("order", "id.asc")])
    if len(rows) > limit:
        raise HTTPException(400, f"{len(rows)} doctors match these filters; narrow them to {limit} or fewer")
    return [r["id"] for r in rows]


# ================================================================== categories
@router.get("/categories/summary")
async def category_summary(user: CurrentUser = Depends(npp_user)):
    """Per-category figures from live records (current category)."""
    return await user.db().rpc("npp_category_summary")


@router.get("/categories/board")
async def category_board(
    category: Literal["A", "B", "C", "UNASSIGNED"],
    q: str | None = Query(None, max_length=120),
    specialty: str | None = None,
    sub_department: str | None = None,
    city: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    user: CurrentUser = Depends(npp_user),
):
    f = DoctorFilters(q=q, specialty=specialty, sub_department=sub_department, city=city,
                      category="none" if category == "UNASSIGNED" else category)
    params = _filter_params(user, f) + [("select", CARD_COLUMNS), ("order", "doctor_name.asc,id.asc")]
    rows, total = await user.db().select("doctors", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


class CategorySelection(BaseModel):
    doctor_ids: list[str] | None = Field(None, max_length=5000)
    filters: DoctorFilters | None = None


@router.post("/categories/preview")
async def category_preview(body: CategorySelection, user: CurrentUser = Depends(npp_user)):
    """What a bulk update would touch: total selected and their current category distribution."""
    ids = await _resolve_ids(user, body.doctor_ids, body.filters)
    dist: Counter[str] = Counter()
    for i in range(0, len(ids), 200):
        rows, _ = await user.db().select("doctors", [("id", f"in.({','.join(ids[i:i + 200])})"),
                                                     ("department", f"eq.{DEPT}"), ("select", "category")])
        dist.update((r["category"] or "UNASSIGNED") for r in rows)
    return {"total": sum(dist.values()), "requested": len(ids),
            "distribution": {k: dist.get(k, 0) for k in ("A", "B", "C", "UNASSIGNED")}}


class CategoryAssign(CategorySelection):
    category: Literal["A", "B", "C"] | None  # None = clear (explicit)
    source: Literal["MANUAL", "DRAG_DROP", "BULK"] = "MANUAL"


@router.post("/categories/assign")
async def assign_category(body: CategoryAssign, request: Request, user: CurrentUser = Depends(npp_user)):
    ids = await _resolve_ids(user, body.doctor_ids, body.filters)
    if not ids:
        raise HTTPException(400, "No doctors selected")
    try:
        result = await user.db().rpc("set_doctor_categories",
                                     {"p_ids": ids, "p_category": body.category, "p_source": body.source})
    except SupabaseError as exc:
        raise HTTPException(400, exc.message)
    await audit("Doctor category changed", user, "doctor", ids[0] if len(ids) == 1 else None,
                {"category": body.category or "blank", "source": body.source, "requested": len(ids),
                 "updated": result.get("updated"), "batch_id": result.get("batch_id")}, request)
    return result


@router.get("/categories/history")
async def category_history(doctor_id: str | None = None, limit: int = Query(50, ge=1, le=500),
                           user: CurrentUser = Depends(npp_user)):
    params: list[tuple[str, str]] = [("department", f"eq.{DEPT}"), ("order", "created_at.desc,id.desc"),
                                     ("select", "id,doctor_id,previous_category,new_category,source,changed_by_email,created_at,"
                                                "doctors(doctor_name)")]
    if doctor_id:
        _uuid_list([doctor_id])
        params.append(("doctor_id", f"eq.{doctor_id}"))
    rows, _ = await user.db().select("doctor_category_changes", params, limit=limit)
    return rows


# ---------------------------------------------------------------- category import (CSV / Excel)
def _read_table(name: str, data: bytes) -> list[dict[str, str]]:
    lower = name.lower()
    if lower.endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = [[("" if c is None else str(c)).strip() for c in r] for r in ws.iter_rows(values_only=True)]
    else:
        text = data.decode("utf-8-sig", errors="replace")
        rows = [[c.strip() for c in r] for r in csv.reader(io.StringIO(text))]
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    header = [re.sub(r"[\s_]+", " ", h).strip().lower() for h in rows[0]]
    return [{header[i]: (r[i] if i < len(r) else "") for i in range(len(header))} for r in rows[1:]]


def _pick(row: dict[str, str], *names: str) -> str:
    for n in names:
        if row.get(n):
            return row[n].strip()
    return ""


@router.post("/categories/import/preview")
async def import_preview(file: UploadFile = File(...), user: CurrentUser = Depends(npp_user)):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "File is larger than 5 MB")
    try:
        table = _read_table(file.filename or "", data)
    except Exception as exc:  # unreadable file
        raise HTTPException(400, f"Could not read the file: {exc}")
    if not table:
        raise HTTPException(400, "The file has no rows")
    if not any(k in table[0] for k in ("doctor category", "category")):
        raise HTTPException(400, "The file needs a Doctor_Category (or Category) column")

    doctors = await user.db().select_all("doctors", [("department", f"eq.{DEPT}"),
                                                     ("select", "id,doctor_name,email_norm,name_norm,category")])
    by_id = {d["id"]: d for d in doctors}
    by_email: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}
    for d in doctors:
        if d.get("email_norm"):
            by_email.setdefault(d["email_norm"], []).append(d)
        if d.get("name_norm"):
            by_name.setdefault(d["name_norm"], []).append(d)

    out, seen = [], set()
    counts = Counter()
    for n, row in enumerate(table, start=2):
        raw_cat = _pick(row, "doctor category", "category")
        cat = raw_cat.upper().replace("CATEGORY", "").strip()
        did = _pick(row, "doctor id", "id")
        email = _pick(row, "email", "email id", "email address").lower()
        name = _pick(row, "doctor name", "name")
        item: dict[str, Any] = {"row": n, "doctor_id": None, "doctor_name": name, "email": email,
                                "category": cat or None, "current": None, "action": None, "reason": None}
        counts["total"] += 1
        if cat and cat not in CATS:
            item.update(action="invalid", reason=f"'{raw_cat}' is not A, B, C or blank")
            counts["invalid"] += 1
            out.append(item)
            continue
        match = by_id.get(did) if did else None
        how = "Doctor_ID" if match else None
        if not match and email and len(by_email.get(email, [])) == 1:
            match, how = by_email[email][0], "email"
        if not match and name:
            key = re.sub(r"[^a-z]", "", re.sub(r"^dr\.?\s*", "", name.lower()))
            cands = [d for nk, ds in by_name.items() if re.sub(r"[^a-z]", "", nk) == key for d in ds]
            if len(cands) == 1:
                match, how = cands[0], "name"
        if not match:
            item.update(action="not_found", reason="No unique NPP doctor matches this Doctor_ID / email / name")
            counts["not_found"] += 1
            out.append(item)
            continue
        item.update(doctor_id=match["id"], doctor_name=match["doctor_name"], current=match.get("category"), matched_by=how)
        if match["id"] in seen:
            item.update(action="duplicate", reason="Same doctor appears earlier in the file")
            counts["duplicate"] += 1
        elif not cat:
            item.update(action="blank", reason="Blank in file: kept as is unless you choose to clear")
            counts["blank"] += 1
            if match.get("category"):
                counts["blank_with_existing"] += 1
        elif cat == match.get("category"):
            item.update(action="unchanged")
            counts["unchanged"] += 1
        else:
            item.update(action="update")
            counts["update"] += 1
        if match.get("category"):
            counts["existing_categories"] += 1
        seen.add(match["id"])
        out.append(item)
    counts["valid"] = counts["total"] - counts["invalid"] - counts["not_found"] - counts["duplicate"]
    return {"summary": dict(counts), "rows": out}


class ImportApply(BaseModel):
    rows: list[dict[str, Any]] = Field(..., max_length=5000)
    clear_blank: bool = False


@router.post("/categories/import/apply")
async def import_apply(body: ImportApply, request: Request, user: CurrentUser = Depends(npp_user)):
    groups: dict[str | None, list[str]] = {}
    for r in body.rows:
        if r.get("action") == "update" and r.get("category") in CATS and r.get("doctor_id"):
            groups.setdefault(r["category"], []).append(r["doctor_id"])
        elif r.get("action") == "blank" and body.clear_blank and r.get("doctor_id") and r.get("current"):
            groups.setdefault(None, []).append(r["doctor_id"])
    results, updated, failed = [], 0, []
    for cat, ids in groups.items():
        try:
            res = await user.db().rpc("set_doctor_categories",
                                      {"p_ids": _uuid_list(ids), "p_category": cat, "p_source": "CSV_IMPORT"})
            updated += res.get("updated", 0)
            results.append({"category": cat or "blank", **res})
        except SupabaseError as exc:
            failed.append({"category": cat or "blank", "doctors": len(ids), "error": exc.message})
    await audit("Doctor categories imported", user, "doctor", None,
                {"updated": updated, "groups": [r["category"] for r in results], "failed": len(failed)}, request)
    return {"updated": updated, "results": results, "failed": failed}


# ================================================================== groups
class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    filters: DoctorFilters | None = None
    add_matching: bool = True
    doctor_ids: list[str] | None = Field(None, max_length=5000)


class GroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)


class GroupMembers(BaseModel):
    doctor_ids: list[str] | None = Field(None, max_length=5000)
    filters: DoctorFilters | None = None


def _gid(group_id: str) -> str:
    if not UUID_RE.match(group_id):
        raise HTTPException(400, "Invalid group id")
    return group_id


async def _add_members(user: CurrentUser, group_id: str, ids: list[str]) -> int:
    added = 0
    for i in range(0, len(ids), 500):
        rows = [{"group_id": group_id, "doctor_id": d} for d in ids[i:i + 500]]
        ins = await user.db().insert("doctor_group_members", rows, on_conflict="group_id,doctor_id",
                                     resolution="ignore-duplicates", returning="doctor_id")
        added += len(ins)
    return added


@router.get("/groups")
async def list_groups(user: CurrentUser = Depends(npp_user)):
    rows, _ = await user.db().select("doctor_group_stats", [("department", f"eq.{DEPT}"), ("select", "*"),
                                                            ("order", "updated_at.desc")])
    return rows


@router.post("/groups")
async def create_group(body: GroupCreate, request: Request, user: CurrentUser = Depends(npp_user)):
    try:
        g = (await user.db().insert("doctor_groups", {
            "department": DEPT, "name": body.name.strip(), "description": body.description,
            "filters": body.filters.model_dump(exclude_none=True) if body.filters else {},
        }, returning="*"))[0]
    except SupabaseError as exc:
        if "duplicate" in exc.message.lower() or "unique" in exc.message.lower():
            raise HTTPException(409, "A group with this name already exists")
        raise HTTPException(400, exc.message)
    added = 0
    if body.doctor_ids or (body.add_matching and body.filters):
        ids = await _resolve_ids(user, body.doctor_ids, body.filters if body.add_matching else None)
        added = await _add_members(user, g["id"], ids)
    await audit("Doctor group created", user, "doctor_group", g["id"], {"name": g["name"], "members": added}, request)
    return {**g, "added": added}


@router.patch("/groups/{group_id}")
async def update_group(group_id: str, body: GroupUpdate, request: Request, user: CurrentUser = Depends(npp_user)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "Nothing to update")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        rows = await user.db().update("doctor_groups", [("id", f"eq.{_gid(group_id)}")], patch, returning="*")
    except SupabaseError as exc:
        raise HTTPException(409 if "unique" in exc.message.lower() else 400,
                            "A group with this name already exists" if "unique" in exc.message.lower() else exc.message)
    if not rows:
        raise HTTPException(404, "Group not found")
    await audit("Doctor group updated", user, "doctor_group", group_id, patch, request)
    return rows[0]


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request, user: CurrentUser = Depends(npp_user)):
    await user.db().delete("doctor_groups", [("id", f"eq.{_gid(group_id)}")])
    await audit("Doctor group deleted", user, "doctor_group", group_id, {}, request)
    return {"ok": True}


@router.get("/groups/{group_id}/members")
async def group_members(group_id: str, q: str | None = Query(None, max_length=120),
                        page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
                        user: CurrentUser = Depends(npp_user)):
    params: list[tuple[str, str]] = [("group_id", f"eq.{_gid(group_id)}"),
                                     ("select", f"added_at,doctors!inner({CARD_COLUMNS})"),
                                     ("order", "added_at.desc")]
    if q:
        safe = re.sub(r"[^\w\s@.-]", " ", q).strip()
        if safe:
            params.append(("doctors.search_text", f"ilike.*{safe.lower()}*"))
    rows, total = await user.db().select("doctor_group_members", params, count=True,
                                         offset=(page - 1) * page_size, limit=page_size)
    return {"items": [{**r["doctors"], "added_at": r["added_at"]} for r in rows], "total": total or 0}


@router.post("/groups/{group_id}/members")
async def add_members(group_id: str, body: GroupMembers, request: Request, user: CurrentUser = Depends(npp_user)):
    ids = await _resolve_ids(user, body.doctor_ids, body.filters)
    added = await _add_members(user, _gid(group_id), ids)
    await user.db().update("doctor_groups", [("id", f"eq.{group_id}")], {"updated_at": datetime.now(timezone.utc).isoformat()})
    await audit("Doctors added to group", user, "doctor_group", group_id, {"selected": len(ids), "added": added}, request)
    return {"selected": len(ids), "added": added, "already_in_group": len(ids) - added}


@router.post("/groups/{group_id}/members/remove")
async def remove_members(group_id: str, body: GroupMembers, request: Request, user: CurrentUser = Depends(npp_user)):
    ids = _uuid_list(body.doctor_ids or [])
    if not ids:
        raise HTTPException(400, "Select doctors to remove")
    for i in range(0, len(ids), 200):
        await user.db().delete("doctor_group_members", [("group_id", f"eq.{_gid(group_id)}"),
                                                        ("doctor_id", f"in.({','.join(ids[i:i + 200])})")])
    await audit("Doctors removed from group", user, "doctor_group", group_id, {"removed": len(ids)}, request)
    return {"removed": len(ids)}


@router.get("/groups/{group_id}/export")
async def export_group(group_id: str, user: CurrentUser = Depends(npp_user)):
    rows = await user.db().select_all("doctor_group_members", [
        ("group_id", f"eq.{_gid(group_id)}"),
        ("select", "doctors!inner(id,doctor_name,category,specialty,sub_department,institute,city,state,country,email,whatsapp_number,"
                   "emails_sent,whatsapp_sent,last_contact_at)")])
    cols = [("Doctor_ID", "id"), ("Doctor_Name", "doctor_name"), ("Doctor_Category", "category"), ("Specialization", "specialty"),
            ("Department", "sub_department"), ("Hospital", "institute"), ("City", "city"), ("State", "state"),
            ("Country", "country"), ("Email", "email"), ("WhatsApp_Number", "whatsapp_number"),
            ("Emails_Sent", "emails_sent"), ("WhatsApp_Sent", "whatsapp_sent"), ("Last_Contact", "last_contact_at")]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c for c, _ in cols])
    for r in rows:
        d = r["doctors"]
        w.writerow(["" if d.get(k) is None else d.get(k) for _, k in cols])
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="group-{group_id[:8]}.csv"'})


# ================================================================== outreach campaigns
class Audience(BaseModel):
    type: Literal["category", "group", "selected", "filters"]
    categories: list[Literal["A", "B", "C"]] = []
    group_ids: list[str] = []
    doctor_ids: list[str] = Field(default_factory=list, max_length=5000)
    filters: DoctorFilters | None = None
    include_unassigned: bool = False  # only honoured for explicit custom selections


async def _audience_doctors(user: CurrentUser, a: Audience) -> list[dict]:
    cols = "id,doctor_name,specialty,sub_department,institute,city,state,email,email_norm,whatsapp_number,category,department"
    db = user.db()
    if a.type == "category":
        if not a.categories:
            raise HTTPException(400, "Choose at least one category")
        # Unassigned doctors are never part of a category campaign
        return await db.select_all("doctors", [("department", f"eq.{DEPT}"), ("category", f"in.({','.join(a.categories)})"),
                                               ("select", cols)])
    if a.type == "group":
        if not a.group_ids:
            raise HTTPException(400, "Choose at least one group")
        rows = await db.select_all("doctor_group_members", [("group_id", f"in.({','.join(_uuid_list(a.group_ids))})"),
                                                            ("select", f"doctors!inner({cols})")])
        seen, out = set(), []
        for r in rows:
            d = r["doctors"]
            if d["id"] not in seen and d["department"] == DEPT:
                seen.add(d["id"])
                out.append(d)
        return out
    if a.type == "selected":
        ids = _uuid_list(a.doctor_ids)
        out = []
        for i in range(0, len(ids), 200):
            rows, _ = await db.select("doctors", [("id", f"in.({','.join(ids[i:i + 200])})"),
                                                  ("department", f"eq.{DEPT}"), ("select", cols)])
            out += rows
        return out
    ids = await _resolve_ids(user, None, a.filters or DoctorFilters())
    out = []
    for i in range(0, len(ids), 200):
        rows, _ = await db.select("doctors", [("id", f"in.({','.join(ids[i:i + 200])})"), ("select", cols)])
        out += rows
    if not a.include_unassigned and (a.filters is None or a.filters.category != "none"):
        out = [d for d in out if d.get("category")]
    return out


def _recipient(channel: str, d: dict) -> tuple[str | None, str | None]:
    if channel == "EMAIL":
        return (d.get("email_norm"), None) if d.get("email_norm") else (None, "No valid email address")
    num = whatsapp_service.whatsapp_number(d.get("whatsapp_number"))
    return (num, None) if num else (None, "No WhatsApp number")


VAR_RE = re.compile(r"\{\{\s*(doctor_name|specialty|hospital|city|state|category)\s*\}\}")


def _render(text: str, d: dict) -> str:
    vals = {"doctor_name": d.get("doctor_name") or "Doctor", "specialty": d.get("specialty") or d.get("sub_department") or "",
            "hospital": d.get("institute") or "", "city": d.get("city") or "", "state": d.get("state") or "",
            "category": d.get("category") or ""}
    return VAR_RE.sub(lambda m: vals[m.group(1)], text or "")


def _email_html(text: str) -> str:
    body = "<br>".join(html.escape(line) for line in text.splitlines())
    return (f'<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#29251F">{body}</div>')


async def _whatsapp_template(user: CurrentUser, template_id: str | None) -> dict | None:
    if not template_id:
        return None
    rows, _ = await user.db().select("message_templates", [("id", f"eq.{_gid(template_id)}"),
                                                           ("select", "id,name,whatsapp_template_name,whatsapp_approval_status,"
                                                                      "whatsapp_variables,language,body")])
    if not rows:
        raise HTTPException(404, "WhatsApp template not found")
    t = rows[0]
    if t.get("whatsapp_approval_status") != "APPROVED" or not t.get("whatsapp_template_name"):
        raise HTTPException(400, "This WhatsApp template is not approved in Cunnekt yet")
    doctor_vars = {"doctor_name", "specialty", "hospital", "city", "state", "category"}
    unsupported = [v for v in (t.get("whatsapp_variables") or []) if v not in doctor_vars]
    if unsupported:
        raise HTTPException(400, "This template needs drug details (" + ", ".join(unsupported) +
                            "). For doctor outreach use an approved template whose fields are doctor details only.")
    return t


def _config_problem(channel: str) -> str | None:
    s = get_settings()
    if channel == "EMAIL" and s.missing_email_config:
        return "Email is not configured on the server: " + ", ".join(s.missing_email_config)
    if channel == "WHATSAPP" and not s.cunnekt_api_key:
        return "WhatsApp is not configured on the server: CUNNEKT_API_KEY"
    return None


class OutreachPreview(BaseModel):
    channel: Literal["EMAIL", "WHATSAPP"]
    audience: Audience


@router.post("/outreach/preview")
async def outreach_preview(body: OutreachPreview, user: CurrentUser = Depends(npp_user)):
    docs = await _audience_doctors(user, body.audience)
    ok, skipped, dist = [], Counter(), Counter()
    for d in docs:
        to, reason = _recipient(body.channel, d)
        if to:
            ok.append({"id": d["id"], "doctor_name": d["doctor_name"], "category": d.get("category"), "to": to,
                       "institute": d.get("institute"), "city": d.get("city")})
            dist[d.get("category") or "UNASSIGNED"] += 1
        else:
            skipped[reason] += 1
    return {"matched": len(docs), "sendable": len(ok), "skipped": dict(skipped),
            "by_category": {k: dist.get(k, 0) for k in ("A", "B", "C", "UNASSIGNED")},
            "recipients": ok[:500], "config_problem": _config_problem(body.channel)}


class OutreachCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    channel: Literal["EMAIL", "WHATSAPP"]
    sequence: Literal["1st Email", "2nd Email", "3rd Email", "Follow-up Email", "Final Follow-up", "WhatsApp"] | None = None
    subject: str | None = Field(None, max_length=250)
    body: str = Field("", max_length=20000)
    whatsapp_template_id: str | None = None
    audience: Audience
    exclude_doctor_ids: list[str] = Field(default_factory=list, max_length=5000)
    confirm: bool = False


@router.post("/outreach")
async def create_outreach(body: OutreachCreate, request: Request, user: CurrentUser = Depends(npp_user)):
    """Creates the campaign and its recipient list (category recorded at this moment).
    Nothing is sent until /send is called; sending requires explicit confirmation."""
    if not body.confirm:
        raise HTTPException(400, "Please confirm before sending")
    problem = _config_problem(body.channel)
    if problem:
        raise HTTPException(400, problem)
    if body.channel == "EMAIL" and (not (body.subject or "").strip() or not body.body.strip()):
        raise HTTPException(400, "Email subject and body are required")
    template = await _whatsapp_template(user, body.whatsapp_template_id) if body.channel == "WHATSAPP" else None
    if body.channel == "WHATSAPP" and not template and not body.body.strip():
        raise HTTPException(400, "Write a message or choose an approved WhatsApp template")
    docs = await _audience_doctors(user, body.audience)
    excluded = set(body.exclude_doctor_ids)
    docs = [d for d in docs if d["id"] not in excluded]
    if not docs:
        raise HTTPException(400, "No doctors in this audience")
    camp = (await user.db().insert("outreach_campaigns", {
        "department": DEPT, "name": body.name.strip(), "channel": body.channel,
        "sequence": body.sequence or ("WhatsApp" if body.channel == "WHATSAPP" else None),
        "audience": body.audience.model_dump(), "subject": body.subject,
        "body": body.body if not template else (template.get("body") or ""),
        "whatsapp_template_id": template["id"] if template else None,
        "status": "SENDING", "recipients": len(docs),
    }, returning="*"))[0]
    rows, skipped = [], 0
    for d in docs:
        to, reason = _recipient(body.channel, d)
        rows.append({"campaign_id": camp["id"], "doctor_id": d["id"], "department": DEPT, "channel": body.channel,
                     "category_at_send": d.get("category"), "recipient": to,
                     "status": "QUEUED" if to else "SKIPPED", "error": reason})
        skipped += 0 if to else 1
    for i in range(0, len(rows), 500):
        await user.db().insert("outreach_messages", rows[i:i + 500])
    await user.db().update("outreach_campaigns", [("id", f"eq.{camp['id']}")], {"skipped_count": skipped})
    await audit("Outreach campaign created", user, "outreach_campaign", camp["id"],
                {"name": camp["name"], "channel": body.channel, "recipients": len(docs), "skipped": skipped}, request)
    return {**camp, "skipped_count": skipped, "queued": len(docs) - skipped}


@router.post("/outreach/{campaign_id}/send")
async def send_outreach_batch(campaign_id: str, user: CurrentUser = Depends(npp_user)):
    """Sends the next batch of queued messages. The screen repeats this until nothing is left."""
    db = user.db()
    camp_rows, _ = await db.select("outreach_campaigns", [("id", f"eq.{_gid(campaign_id)}"), ("select", "*")])
    if not camp_rows:
        raise HTTPException(404, "Campaign not found")
    camp = camp_rows[0]
    if camp["status"] in ("CANCELLED",):
        raise HTTPException(400, "This campaign was cancelled")
    problem = _config_problem(camp["channel"])
    if problem:
        raise HTTPException(400, problem)
    template = await _whatsapp_template(user, camp.get("whatsapp_template_id")) if camp.get("whatsapp_template_id") else None
    queued, _ = await db.select("outreach_messages", [
        ("campaign_id", f"eq.{campaign_id}"), ("status", "eq.QUEUED"),
        ("select", "id,doctor_id,recipient,doctors(doctor_name,specialty,sub_department,institute,city,state,category)"),
        ("order", "id.asc")], limit=SEND_BATCH)
    for m in queued:
        d = m.get("doctors") or {}
        try:
            if camp["channel"] == "EMAIL":
                text = _render(camp["body"], d)
                res = await email_service.send_email(m["recipient"], _render(camp.get("subject") or "", d),
                                                     _email_html(text), text, None)
            elif template:
                params = [_render("{{" + v + "}}", d) for v in (template.get("whatsapp_variables") or [])]
                res = await whatsapp_service.send_template(m["recipient"], template["whatsapp_template_name"],
                                                           template.get("language") or "en", params)
            else:
                res = await whatsapp_service.send_text(m["recipient"], _render(camp["body"], d))
            patch = ({"status": "SENT", "provider_message_id": res.provider_message_id, "sent_at": datetime.now(timezone.utc).isoformat(),
                      "error": None} if res.ok else {"status": "FAILED", "error": res.error or "Provider did not accept the message"})
        except ProviderNotConfigured as exc:
            patch = {"status": "FAILED", "error": str(exc)}
        except Exception as exc:  # network etc. — recorded, never reported as sent
            patch = {"status": "FAILED", "error": f"Send error: {exc}"[:500]}
        await db.update("outreach_messages", [("id", f"eq.{m['id']}")], patch)
        await db.rpc("record_outreach_event", {"p_message_id": m["id"]})

    counts = Counter(r["status"] for r in await db.select_all(
        "outreach_messages", [("campaign_id", f"eq.{campaign_id}"), ("select", "status")]))
    remaining = counts.get("QUEUED", 0)
    sent = sum(counts.get(s, 0) for s in ("SENT", "DELIVERED", "READ"))
    failed = counts.get("FAILED", 0)
    status = "SENDING" if remaining else ("SENT" if failed == 0 and sent else ("FAILED" if sent == 0 else "PARTIAL"))
    patch = {"sent_count": sent, "failed_count": failed, "skipped_count": counts.get("SKIPPED", 0), "status": status}
    if not remaining:
        patch["sent_at"] = datetime.now(timezone.utc).isoformat()
    await db.update("outreach_campaigns", [("id", f"eq.{campaign_id}")], patch)
    return {"processed": len(queued), "remaining": remaining, "sent": sent, "failed": failed,
            "skipped": counts.get("SKIPPED", 0), "status": status}


@router.post("/outreach/{campaign_id}/cancel")
async def cancel_outreach(campaign_id: str, request: Request, user: CurrentUser = Depends(npp_user)):
    db = user.db()
    await db.update("outreach_messages", [("campaign_id", f"eq.{_gid(campaign_id)}"), ("status", "eq.QUEUED")],
                    {"status": "SKIPPED", "error": "Campaign cancelled before sending"})
    await db.update("outreach_campaigns", [("id", f"eq.{campaign_id}")], {"status": "CANCELLED"})
    await audit("Outreach campaign cancelled", user, "outreach_campaign", campaign_id, {}, request)
    return {"ok": True}


@router.get("/outreach")
async def list_outreach(user: CurrentUser = Depends(npp_user)):
    rows, _ = await user.db().select("outreach_campaigns", [("department", f"eq.{DEPT}"), ("order", "created_at.desc"),
                                                            ("select", "id,name,channel,sequence,subject,status,recipients,"
                                                                       "sent_count,failed_count,skipped_count,created_at,sent_at,audience")],
                                     limit=200)
    return rows


@router.get("/outreach/{campaign_id}/messages")
async def outreach_messages(campaign_id: str, status: str | None = None, user: CurrentUser = Depends(npp_user)):
    params = [("campaign_id", f"eq.{_gid(campaign_id)}"), ("order", "id.asc"),
              ("select", "id,doctor_id,category_at_send,recipient,status,error,sent_at,provider_message_id,doctors(doctor_name,institute)")]
    if status:
        params.append(("status", f"eq.{status.upper()}"))
    return await user.db().select_all("outreach_messages", params)


@router.get("/outreach-templates")
async def outreach_templates(user: CurrentUser = Depends(npp_user)):
    """Approved WhatsApp templates and whether they can be used for doctor outreach."""
    rows, _ = await user.db().select("message_templates", [("channel", "eq.WHATSAPP"), ("status", "eq.ACTIVE"),
                                                           ("select", "id,name,whatsapp_template_name,whatsapp_approval_status,"
                                                                      "whatsapp_variables,body")])
    doctor_vars = {"doctor_name", "specialty", "hospital", "city", "state", "category"}
    for r in rows:
        bad = [v for v in (r.get("whatsapp_variables") or []) if v not in doctor_vars]
        r["usable"] = r.get("whatsapp_approval_status") == "APPROVED" and bool(r.get("whatsapp_template_name")) and not bad
        r["reason"] = (None if r["usable"] else "Not approved in Cunnekt" if r.get("whatsapp_approval_status") != "APPROVED"
                       else "Needs drug details: " + ", ".join(bad))
    return rows


# ================================================================== reply inbox
@router.get("/inbox")
async def inbox(
    channel: Literal["EMAIL", "WHATSAPP"] = "EMAIL",
    category: str | None = Query(None, pattern="^([ABC]|none)$"),
    read: Literal["read", "unread"] | None = None,
    kind: Literal["replied", "auto"] | None = None,
    q: str | None = Query(None, max_length=120),
    specialty: str | None = None,
    campaign: str | None = Query(None, max_length=160),
    date_from: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=200),
    user: CurrentUser = Depends(npp_user),
):
    params: list[tuple[str, str]] = [
        ("department", f"eq.{DEPT}"), ("direction", "eq.INBOUND"), ("channel", f"eq.{channel}"),
        ("select", "id,doctor_id,channel,status,subject,detail,campaign,occurred_at,read_at,"
                   "doctors!inner(doctor_name,category,specialty,institute,city,email,whatsapp_number)"),
        ("order", "occurred_at.desc.nullslast,id.desc"),
    ]
    if category == "none":
        params.append(("doctors.category", "is.null"))
    elif category:
        params.append(("doctors.category", f"eq.{category}"))
    if specialty:
        params.append(("doctors.specialty", f"eq.{specialty}"))
    if read == "read":
        params.append(("read_at", "not.is.null"))
    elif read == "unread":
        params.append(("read_at", "is.null"))
    if kind == "replied":
        params.append(("status", "eq.Replied"))
    elif kind == "auto":
        params.append(("status", "eq.Auto-reply"))
    if campaign:
        params.append(("campaign", f"eq.{campaign}"))
    if date_from:
        params.append(("occurred_at", f"gte.{date_from}T00:00:00+05:30"))
    if date_to:
        params.append(("occurred_at", f"lte.{date_to}T23:59:59+05:30"))
    if q:
        safe = re.sub(r"[^\w\s@.-]", " ", q).strip()
        if safe:
            params.append(("or", f"(detail.ilike.*{safe}*,doctors.search_text.ilike.*{safe.lower()}*)"))
    rows, total = await user.db().select("communication_events", params, count=True,
                                         offset=(page - 1) * page_size, limit=page_size)
    unread = {}
    for ch in ("EMAIL", "WHATSAPP"):
        _, n = await user.db().select("communication_events", [("department", f"eq.{DEPT}"), ("direction", "eq.INBOUND"),
                                                               ("channel", f"eq.{ch}"), ("read_at", "is.null"),
                                                               ("select", "id")], count=True, limit=1)
        unread[ch] = n or 0
    return {"items": rows, "total": total or 0, "unread": unread}


class ReadUpdate(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=1000)
    read: bool = True


@router.post("/inbox/read")
async def mark_read(body: ReadUpdate, user: CurrentUser = Depends(npp_user)):
    n = await user.db().rpc("mark_replies_read", {"p_ids": body.ids, "p_read": body.read})
    return {"updated": n}


@router.get("/doctors/{doctor_id}/conversation")
async def conversation(doctor_id: str, user: CurrentUser = Depends(npp_user)):
    _uuid_list([doctor_id])
    db = user.db()
    doc, _ = await db.select("doctors", [("id", f"eq.{doctor_id}"), ("department", f"eq.{DEPT}"),
                                         ("select", "id,doctor_name,category,specialty,institute,city,state,country,email,"
                                                    "whatsapp_number,emails_sent,whatsapp_sent,last_contact_at,last_reply_at,"
                                                    "email_reply_status,whatsapp_reply_status")])
    if not doc:
        raise HTTPException(404, "Doctor not found")
    events = await db.select_all("communication_events", [("doctor_id", f"eq.{doctor_id}"),
                                                          ("select", "id,channel,direction,event_type,status,subject,detail,campaign,"
                                                                     "occurred_at,read_at,category_at_send"),
                                                          ("order", "occurred_at.desc.nullslast,id.desc")])
    d = doc[0]
    stats = {
        "emails_sent": sum(1 for e in events if e["channel"] == "EMAIL" and e["direction"] == "OUTBOUND" and e["status"] in ("Sent", "Delivered", "Opened", "Read")),
        "emails_delivered": sum(1 for e in events if e["channel"] == "EMAIL" and e["direction"] == "OUTBOUND" and e["status"] in ("Delivered", "Opened")),
        "email_replies": sum(1 for e in events if e["channel"] == "EMAIL" and e["direction"] == "INBOUND" and e["status"] == "Replied"),
        "whatsapp_sent": sum(1 for e in events if e["channel"] == "WHATSAPP" and e["direction"] == "OUTBOUND" and e["status"] in ("Sent", "Delivered", "Read")),
        "whatsapp_replies": sum(1 for e in events if e["channel"] == "WHATSAPP" and e["direction"] == "INBOUND" and e["status"] == "Replied"),
    }
    engaged = stats["email_replies"] + stats["whatsapp_replies"] > 0
    stats["engagement"] = "Engaged" if engaged else ("Awaiting reply" if stats["emails_sent"] + stats["whatsapp_sent"] else "Not contacted")
    return {"doctor": d, "stats": stats, "events": events}


# ================================================================== analytics
def _range(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    ist = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(ist).replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return today, today + timedelta(days=1)
    if period == "yesterday":
        return today - timedelta(days=1), today
    if period == "7d":
        return today - timedelta(days=6), today + timedelta(days=1)
    if period == "30d":
        return today - timedelta(days=29), today + timedelta(days=1)
    if period == "month":
        return today.replace(day=1), today + timedelta(days=1)
    if period == "custom":
        try:
            f = datetime.fromisoformat(date_from).replace(tzinfo=ist) if date_from else None
            t = datetime.fromisoformat(date_to).replace(tzinfo=ist) + timedelta(days=1) if date_to else None
        except ValueError:
            raise HTTPException(400, "Invalid date")
        return f, t
    return None, None


@router.get("/analytics")
async def analytics(
    period: Literal["all", "today", "yesterday", "7d", "30d", "month", "custom"] = "all",
    date_from: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: CurrentUser = Depends(npp_user),
):
    db = user.db()
    start, end = _range(period, date_from, date_to)
    doctors = await db.select_all("doctors", [("department", f"eq.{DEPT}"),
                                              ("select", "id,category,city,state,specialty,sub_department,institute,email_norm,whatsapp_number")])
    cat_of = {d["id"]: d.get("category") or "UNASSIGNED" for d in doctors}
    ev_params = [("department", f"eq.{DEPT}"), ("select", "doctor_id,channel,direction,status,occurred_at,category_at_send")]
    if start:
        ev_params.append(("occurred_at", f"gte.{start.isoformat()}"))
    if end:
        ev_params.append(("occurred_at", f"lt.{end.isoformat()}"))
    events = await db.select_all("communication_events", ev_params)

    keys = ("A", "B", "C", "UNASSIGNED")
    cur = {k: Counter() for k in keys}
    engaged = {k: set() for k in keys}
    contacted = {k: set() for k in keys}
    for e in events:
        c = cat_of.get(e["doctor_id"], "UNASSIGNED")
        out = e["direction"] == "OUTBOUND"
        ch = "email" if e["channel"] == "EMAIL" else "whatsapp"
        if out and e["status"] in ("Sent", "Delivered", "Opened", "Read"):
            cur[c][f"{ch}_sent"] += 1
            contacted[c].add(e["doctor_id"])
            if e["status"] in ("Delivered", "Opened", "Read"):
                cur[c][f"{ch}_delivered"] += 1
        elif out and e["status"] == "Failed":
            cur[c][f"{ch}_failed"] += 1
        elif not out and e["status"] == "Replied":
            cur[c][f"{ch}_replies"] += 1
            engaged[c].add(e["doctor_id"])

    def rate(a: int, b: int) -> float | None:
        return round(100 * a / b, 1) if b else None

    current = {}
    for k in keys:
        n_docs = sum(1 for v in cat_of.values() if v == k)
        s = cur[k]
        current[k] = {
            "doctors": n_docs, **dict(s),
            "contacted_doctors": len(contacted[k]), "engaged_doctors": len(engaged[k]),
            "email_reply_rate": rate(s["email_replies"], s["email_sent"]),
            "whatsapp_reply_rate": rate(s["whatsapp_replies"], s["whatsapp_sent"]),
            # SMTP only confirms acceptance; without any delivery receipts the rate is unknown, not 0%
            "email_delivery_rate": rate(s["email_delivered"], s["email_sent"]) if s["email_delivered"] else None,
            "engagement_rate": rate(len(engaged[k]), len(contacted[k])),
        }

    def dist(field: str, top: int = 10) -> list[dict]:
        c: dict[str, Counter] = {}
        for d in doctors:
            v = (d.get(field) or "Not set").strip() or "Not set"
            c.setdefault(v, Counter())[d.get("category") or "UNASSIGNED"] += 1
        rows = sorted(c.items(), key=lambda kv: -sum(kv[1].values()))[:top]
        return [{"name": name, **{k: cnt.get(k, 0) for k in keys}, "total": sum(cnt.values())} for name, cnt in rows]

    history = await db.rpc("npp_category_history", {"p_from": start.isoformat() if start else None,
                                                    "p_to": end.isoformat() if end else None})
    return {
        "period": period, "from": start.isoformat() if start else None, "to": end.isoformat() if end else None,
        "current": current, "historical": history,
        "distribution": {"state": dist("state"), "city": dist("city"), "specialty": dist("sub_department"),
                         "hospital": dist("institute")},
        "zone_available": False,
    }
