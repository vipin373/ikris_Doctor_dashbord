from __future__ import annotations

import csv
import io
import re
from typing import Any

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..core.config import get_settings
from ..core.security import CurrentUser, get_current_user
from ..core.supabase import PostgREST, ServiceUnavailable, SupabaseError
from ..services.audit import audit

router = APIRouter(prefix="/api/doctors", tags=["doctors"])

LIST_COLUMNS = (
    "id,s_no,doctor_name,qualification,specialty,category,department,sub_department,institute,city,state,"
    "bdm,nsm,contact_number,email,date_of_birth,date_of_anniversary,last_contact_at,last_contact_status,"
    "last_contact_channel,emails_sent,whatsapp_sent,data_issues"
)
SORTABLE = {
    "doctor_name", "specialty", "category", "institute", "city", "state", "bdm", "nsm", "department",
    "sub_department", "last_contact_at", "emails_sent", "created_at",
}

# "oncologist" should find "Oncology" / "ONC", "geneticist" -> "Genetics", etc.
SPECIALTY_STEMS = [
    (re.compile(r"^(\w+?)olog(ist|ists|y|ical)$"), lambda m: m.group(1)),
    (re.compile(r"^(genetic)(ist|ists|s)$"), lambda m: m.group(1)),
    (re.compile(r"^(paed|ped)(iatric|iatrician|iatrics)?$"), lambda m: "ped"),
]


def search_terms(q: str | None) -> list[str]:
    if not q:
        return []
    text = re.sub(r"[^\w@.+\- ]", " ", q.lower())
    words = [w for w in text.split() if w]
    terms: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w == "category" and i + 1 < len(words) and words[i + 1] in ("a", "b", "c"):
            terms.append(f"category {words[i + 1]}")
            i += 2
            continue
        if w in ("dr", "dr.", "doctor"):
            i += 1
            continue
        for pattern, repl in SPECIALTY_STEMS:
            m = pattern.match(w)
            if m:
                w = repl(m)
                break
        if w == "rare":
            w = "rare disease"
            if i + 1 < len(words) and words[i + 1].startswith("disease"):
                i += 1
        terms.append(w)
        i += 1
    return terms[:8]


def build_filters(
    user: CurrentUser,
    q: str | None,
    department: str | None,
    sub_department: str | None,
    specialty: str | None,
    category: str | None,
    city: str | None,
    bdm: str | None,
    nsm: str | None,
    has_email: bool | None,
    has_phone: bool | None,
    contact: str | None,
    data_issue: str | None,
) -> list[tuple[str, str]]:
    departments = user.ensure_department(department)
    f: list[tuple[str, str]] = [("department", f"in.({','.join(departments)})")]
    terms = search_terms(q)
    if terms:
        f.append(("and", "(" + ",".join(f'search_text.ilike."*{t}*"' for t in terms) + ")"))
    if sub_department:
        f.append(("sub_department", "is.null" if sub_department == "Unassigned" else f"eq.{sub_department}"))
    if specialty:
        f.append(("specialty", f"eq.{specialty}"))
    if category:
        f.append(("category", f"eq.{category}"))
    if city:
        f.append(("city_norm", f"eq.{city.strip().lower()}"))
    if bdm:
        f.append(("bdm", f"eq.{bdm}"))
    if nsm:
        f.append(("nsm", f"eq.{nsm}"))
    if has_email is not None:
        f.append(("email_norm", "not.is.null" if has_email else "is.null"))
    if has_phone is not None:
        f.append(("phone_norm", "not.is.null" if has_phone else "is.null"))
    if contact == "contacted":
        f.append(("emails_sent", "gt.0"))
    elif contact == "not_contacted":
        f.append(("emails_sent", "eq.0"))
    elif contact:
        f.append(("last_contact_status", f"eq.{contact}"))
    if data_issue == "any":
        f.append(("data_issues", "neq.[]"))
    elif data_issue:
        f.append(("data_issues", f'cs.["{data_issue}"]'))
    return f


def _filter_params(
    q: str | None = None,
    department: str | None = None,
    sub_department: str | None = None,
    specialty: str | None = None,
    category: str | None = Query(None, pattern="^[ABC]$"),
    city: str | None = None,
    bdm: str | None = None,
    nsm: str | None = None,
    has_email: bool | None = None,
    has_phone: bool | None = None,
    contact: str | None = None,
    data_issue: str | None = None,
) -> dict[str, Any]:
    return locals()


@router.get("")
async def list_doctors(
    filters: dict = Depends(_filter_params),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "doctor_name",
    order: str = Query("asc", pattern="^(asc|desc)$"),
    user: CurrentUser = Depends(get_current_user),
):
    if sort not in SORTABLE:
        sort = "doctor_name"
    params = build_filters(user, **filters)
    params += [("select", LIST_COLUMNS), ("order", f"{sort}.{order}.nullslast,id.asc")]
    rows, total = await user.db().select("doctors", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size,
            "search_terms": search_terms(filters.get("q"))}


@router.get("/facets")
async def facets(user: CurrentUser = Depends(get_current_user)):
    return await user.db().rpc("doctor_facets")


@router.get("/export")
async def export_doctors(
    request: Request,
    filters: dict = Depends(_filter_params),
    user: CurrentUser = Depends(get_current_user),
):
    params = build_filters(user, **filters)
    params += [("select", LIST_COLUMNS + ",institute_address,country,whatsapp_number"), ("order", "department,doctor_name")]
    rows, _ = await user.db().select("doctors", params, limit=10000)
    columns = [
        ("S.No", "s_no"), ("Doctor Name", "doctor_name"), ("Qualification", "qualification"),
        ("Department", "department"), ("Sub-Department", "sub_department"), ("Specialty", "specialty"),
        ("Category", "category"), ("Institute", "institute"), ("Institute Address", "institute_address"),
        ("City", "city"), ("State", "state"), ("Country", "country"), ("BDM", "bdm"), ("NSM", "nsm"),
        ("Contact Number", "contact_number"), ("WhatsApp", "whatsapp_number"), ("Email", "email"),
        ("Date of Birth", "date_of_birth"), ("Date of Anniversary", "date_of_anniversary"),
        ("Emails Sent", "emails_sent"), ("Last Contact", "last_contact_at"), ("Last Status", "last_contact_status"),
        ("Data Issues", "data_issues"),
    ]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([c[0] for c in columns])
    for r in rows:
        writer.writerow([", ".join(r[k]) if isinstance(r.get(k), list) else (r.get(k) or "") for _, k in columns])
    await audit("Doctors exported", user, "doctors", details={"count": len(rows), "filters": {k: v for k, v in filters.items() if v not in (None, "")}}, request=request)
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ikris-doctors.csv"'},
    )


@router.get("/{doctor_id}")
async def get_doctor(doctor_id: str, user: CurrentUser = Depends(get_current_user)):
    if not re.fullmatch(r"[0-9a-f-]{36}", doctor_id):
        raise HTTPException(400, "Invalid doctor id")
    db = user.db()
    rows, _ = await db.select("doctors", {"id": f"eq.{doctor_id}", "select": "*"})
    if not rows:
        # Either it does not exist or RLS hides it from this role.
        raise HTTPException(404, "Doctor not found")
    doctor = rows[0]
    doctor.pop("search_text", None)
    sources, _ = await db.select("doctor_source_rows", {
        "doctor_id": f"eq.{doctor_id}",
        "select": "tab_id,spreadsheet_id,sheet_name,row_number,raw_data,missing_from_source,first_seen_at,last_synced_at",
        "order": "first_seen_at",
    })
    events, _ = await db.select("communication_events", {
        "doctor_id": f"eq.{doctor_id}",
        "select": "id,channel,direction,event_type,status,subject,detail,campaign,occurred_at,source",
        "order": "occurred_at.desc.nullslast,id.desc",
    })
    names = await _source_names([s["spreadsheet_id"] for s in sources], user)
    for s in sources:
        s["source_name"] = names.get(s["spreadsheet_id"])
    return {"doctor": doctor, "sources": sources, "events": events}


class DatesUpdate(BaseModel):
    date_of_birth: date | None = None
    date_of_anniversary: date | None = None


@router.put("/{doctor_id}/dates")
async def update_dates(doctor_id: str, body: DatesUpdate, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Birthday / anniversary entered in the dashboard. Kept across syncs
    unless the Google Sheet supplies its own value."""
    if not re.fullmatch(r"[0-9a-f-]{36}", doctor_id):
        raise HTTPException(400, "Invalid doctor id")
    await user.db().rpc("set_doctor_dates", {
        "p_doctor": doctor_id,
        "p_dob": body.date_of_birth.isoformat() if body.date_of_birth else None,
        "p_anniversary": body.date_of_anniversary.isoformat() if body.date_of_anniversary else None,
    })
    await audit("Doctor updated", user, "doctor", doctor_id, {"fields": ["date_of_birth", "date_of_anniversary"]}, request)
    return {"ok": True}


async def _source_names(spreadsheet_ids: list[str], user: CurrentUser) -> dict[str, str]:
    """Spreadsheet display names. Read with the service role because the
    connection table is Admin-only, and only the name is returned."""
    ids = sorted(set(spreadsheet_ids))
    if not ids:
        return {}
    try:
        db = PostgREST.service() if get_settings().has_service_role else user.db()
        rows, _ = await db.select(
            "google_sheet_sources", {"spreadsheet_id": f"in.({','.join(ids)})", "select": "spreadsheet_id,name"}
        )
    except (ServiceUnavailable, SupabaseError):
        return {}
    return {r["spreadsheet_id"]: r["name"] for r in rows}
