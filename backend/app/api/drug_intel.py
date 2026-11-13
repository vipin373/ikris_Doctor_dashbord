"""International Drug Intelligence API.

Access
- Every signed-in user (Admin, NPP, Rare Disease) can search drugs, view approvals,
  map drugs to their own department's doctors and create NPP drug requests.
- Only Admin can import, edit drug records and record verifications.

Rules
- Regulatory facts come from the official source named on each record. A country
  without a record is "Not Verified" — never "not approved".
- Approval is shown separately from marketing, stock and import eligibility; the app
  never draws a legal or import-eligibility conclusion.
- NPP requests carry a pseudonymous patient reference only, visible to the assigned
  department and Admin.
"""

from __future__ import annotations

import asyncio
import csv
import io
import re
from datetime import date, datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core.security import DEPARTMENTS, CurrentUser, get_current_user
from ..core.supabase import PostgREST, SupabaseError
from ..services import drug_intel as di
from ..services.audit import audit

router = APIRouter(prefix="/api/drug-intel", tags=["drug-intel"])

DRUG_ID = re.compile(r"^IDI-\d{6}$")
REQ_ID = re.compile(r"^REQ-\d{6}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LIST_COLUMNS = ("id,generic_name,brand_names,kegg_drug_id,therapeutic_area,manufacturer,mah,us_status,us_date,eu_status,"
                "eu_date,uk_status,jp_status,jp_date,is_orphan,orphan_eu,orphan_us,orphan_jp,is_oncology,is_rare,last_verified,"
                "verification_status,approved_regions,mapped_doctors,latest_approval_date,first_approval_date,pending_verification")
IMPORT_BATCH = 300
CHECK_VALUES = ("Not checked", "Pending", "Confirmed", "Not available", "Not applicable")
REQUEST_STATUSES = ("New", "Regulatory check", "Sourcing", "Awaiting documents", "Approved by compliance", "Fulfilled", "Closed", "Cancelled")
REG_CHECK = ("Not started", "In progress", "Approval verified", "No approval record found", "Referred to compliance", "Completed")
SPECIALTY_TOKENS = {
    "Oncology": ["onc", "cancer"], "Hematology": ["hema", "haema"], "Neurology": ["neuro"],
    "Nephrology": ["nephro", "renal", "kidney"], "Genetics / rare disease": ["genet", "metabolic"],
    "Gastroenterology / hepatology": ["gastro", "hepat", "liver"], "Transplant": ["transplant"],
    "Cardiology": ["cardio"], "Endocrinology": ["endocrin", "diabet"], "Pulmonology": ["pulmo", "respir", "chest"],
    "Rheumatology / immunology": ["rheum", "immunolog"], "Ophthalmology": ["ophthal"], "Dermatology": ["derma"],
    "Infectious disease": ["infect"],
}


def admin_only(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(403, "Only Admin can change drug records, import or verify")
    return user


def _drug_id(v: str) -> str:
    if not DRUG_ID.match(v or ""):
        raise HTTPException(400, "Invalid Drug_ID")
    return v


def _arr(values: list[str]) -> str:
    return "{" + ",".join('"' + v.replace('"', "") + '"' for v in values) + "}"


def _clean_q(q: str) -> str:
    return re.sub(r"[%*(),\\\"']+", " ", q).strip().lower()[:80]


# ------------------------------------------------------------------ list filters
class ListFilters(BaseModel):
    q: str | None = None
    region: str | None = Field(None, pattern="^(USA|Europe|Japan|Other)$")
    country: str | None = Field(None, pattern="^[A-Z]{2}$")
    authority: str | None = None
    status: str | None = None
    area: str | None = None
    oncology: bool | None = None
    rare: bool | None = None
    orphan: bool | None = None
    manufacturer: str | None = None
    year: int | None = Field(None, ge=1938, le=2100)
    verification: str | None = None
    preset: str | None = Field(None, pattern="^(recent|multi|pending|mapped)$")


def overview_filters(f: ListFilters) -> list[tuple[str, str]]:
    p: list[tuple[str, str]] = []
    if f.status and f.status not in di.STATUSES:
        raise HTTPException(400, "Unknown approval status")
    if f.q:
        q = _clean_q(f.q)
        if q:
            p.append(("search_text", f"ilike.*{q}*"))
    if f.country:
        others = [s for s in di.STATUSES if s != "Not Verified"]
        if f.status == "Not Verified":
            p.append(("country_status", "not.ov." + _arr([f"{f.country}:{s}" for s in others])))
        elif f.status:
            p.append(("country_status", "cs." + _arr([f"{f.country}:{f.status}"])))
        else:
            p.append(("country_status", "ov." + _arr([f"{f.country}:{s}" for s in di.STATUSES])))
    elif f.region:
        if f.status:
            p.append(("region_status", "cs." + _arr([f"{f.region}:{f.status}"])))
        else:
            p.append(("region_status", "ov." + _arr([f"{f.region}:{s}" for s in di.STATUSES])))
    elif f.status:
        p.append(("region_status", "ov." + _arr([f"{r}:{f.status}" for r in ("USA", "Europe", "Japan", "Other")])))
    if f.authority:
        p.append(("authorities", "cs." + _arr([f.authority])))
    if f.area:
        p.append(("therapeutic_area", f"eq.{f.area}"))
    if f.oncology is not None:
        p.append(("is_oncology", f"is.{str(f.oncology).lower()}"))
    if f.rare is not None:
        p.append(("is_rare", f"is.{str(f.rare).lower()}"))
    if f.orphan is not None:
        p.append(("is_orphan", f"is.{str(f.orphan).lower()}"))
    if f.manufacturer:
        m = _clean_q(f.manufacturer)
        p.append(("or", f"(manufacturer.ilike.*{m}*,mah.ilike.*{m}*)"))
    if f.year:
        p.append(("approval_years", "cs." + _arr([str(f.year)])))
    if f.verification:
        if f.verification not in ("Verified", "Source-imported", "Needs Review", "Not Verified"):
            raise HTTPException(400, "Unknown verification status")
        p.append(("verification_status", f"eq.{f.verification}"))
    if f.preset == "recent":
        p.append(("latest_approval_date", f"gte.{date.today().replace(year=date.today().year - 1).isoformat()}"))
    elif f.preset == "multi":
        p.append(("approved_regions", "gte.2"))
    elif f.preset == "pending":
        p.append(("pending_verification", "is.true"))
    elif f.preset == "mapped":
        p.append(("mapped_doctors", "gt.0"))
    return p


def list_filters(
    q: str | None = None, region: str | None = None, country: str | None = None, authority: str | None = None,
    status: str | None = None, area: str | None = None, oncology: bool | None = None, rare: bool | None = None,
    orphan: bool | None = None, manufacturer: str | None = None, year: int | None = None,
    verification: str | None = None, preset: str | None = None,
) -> ListFilters:
    try:
        return ListFilters(q=q, region=region, country=country.upper() if country else None, authority=authority,
                           status=status, area=area, oncology=oncology, rare=rare, orphan=orphan,
                           manufacturer=manufacturer, year=year, verification=verification, preset=preset)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid filter: {exc}") from exc


# ------------------------------------------------------------------ dashboard / list
@router.get("/summary")
async def summary(user: CurrentUser = Depends(get_current_user)):
    data = await user.db().rpc("intl_summary")
    return {**data, "is_admin": user.is_admin, "matrix": [{"code": c, "name": di.country_meta(c)[0]} for c in di.MATRIX]}


@router.get("/meta")
async def meta(user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows = await db.select_all("intl_drugs", [("select", "therapeutic_area"), ("therapeutic_area", "not.is.null")])
    areas = sorted({r["therapeutic_area"] for r in rows})
    return {
        "statuses": list(di.STATUSES), "areas": areas,
        "countries": [{"code": c, "name": n, "region": r, "authority": a} for c, (n, r, a) in di.COUNTRIES.items()],
        "matrix": list(di.MATRIX), "request_statuses": list(REQUEST_STATUSES), "regulatory_checks": list(REG_CHECK),
        "check_values": list(CHECK_VALUES), "departments": list(user.departments), "is_admin": user.is_admin,
    }


@router.get("/drugs")
async def list_drugs(
    f: ListFilters = Depends(list_filters),
    sort: str = Query("name", pattern="^(name|recent|updated|regions)$"),
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    order = {"name": "generic_name.asc", "recent": "latest_approval_date.desc.nullslast,generic_name.asc",
             "updated": "updated_at.desc", "regions": "approved_regions.desc,generic_name.asc"}[sort]
    params = overview_filters(f) + [("select", LIST_COLUMNS), ("order", order)]
    rows, total = await user.db().select("intl_drug_overview", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


async def _drug(db: PostgREST, drug_id: str) -> dict:
    rows, _ = await db.select("intl_drugs", {"id": f"eq.{drug_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Drug not found")
    return rows[0]


def _matrix(approvals: list[dict]) -> list[dict]:
    by = {a["country"]: a for a in approvals}
    codes = list(di.MATRIX) + sorted(c for c in by if c not in di.MATRIX)
    out = []
    for c in codes:
        name, region, authority = di.country_meta(c)
        a = by.get(c)
        out.append({"country": c, "name": name, "region": region, "authority": (a or {}).get("authority") or authority,
                    "record": a, "status": a["approval_status"] if a else "Not Verified", "has_record": bool(a)})
    return out


@router.get("/drugs/{drug_id}")
async def get_drug(drug_id: str, user: CurrentUser = Depends(get_current_user)):
    _drug_id(drug_id)
    db = user.db()
    drug = await _drug(db, drug_id)
    (approvals, _), (indications, _), (history, _), (mapped, mapped_count), (requests, _) = await asyncio.gather(
        db.select("intl_drug_approvals", {"drug_id": f"eq.{drug_id}", "select": "*", "order": "country.asc"}),
        db.select("intl_drug_indications", {"drug_id": f"eq.{drug_id}", "select": "*", "order": "country.asc"}),
        db.select("intl_drug_history", {"drug_id": f"eq.{drug_id}", "select": "*", "order": "updated_on.desc", "limit": "100"}),
        db.select("doctor_drug_mappings", {"drug_id": f"eq.{drug_id}", "select": "id", "limit": "1"}, count=True),
        db.select("npp_drug_requests", {"drug_id": f"eq.{drug_id}", "select": "id,request_status,required_country,request_date",
                                        "order": "request_date.desc", "limit": "20"}),
    )
    docs = []
    for a in approvals:
        name = di.country_meta(a["country"])[0]
        if a.get("source_url"):
            docs.append({"country": a["country"], "type": "Regulatory record", "label": f"{a.get('authority') or name} record", "url": a["source_url"]})
        if a.get("label_url"):
            docs.append({"country": a["country"], "type": "Product label", "label": f"{name} product label", "url": a["label_url"]})
    return {
        "drug": {**drug, "orphan_label": di.orphan_label(drug)},
        "matrix": _matrix(approvals), "indications": indications, "history": history, "documents": docs,
        "mapped_doctors": mapped_count or 0, "requests": requests, "is_admin": user.is_admin,
        "suggested_specialties": [label for label, _ in di.relevant_specialties(drug)],
    }


@router.get("/compare")
async def compare(ids: str = Query(..., description="Comma-separated Drug_IDs (2–5)"), user: CurrentUser = Depends(get_current_user)):
    id_list = list(dict.fromkeys(i.strip() for i in ids.split(",") if i.strip()))
    if not 2 <= len(id_list) <= 5:
        raise HTTPException(400, "Choose 2 to 5 drugs to compare")
    for i in id_list:
        _drug_id(i)
    db = user.db()
    flt = "in.(" + ",".join(id_list) + ")"
    (drugs, _), (approvals, _) = await asyncio.gather(
        db.select("intl_drugs", {"id": flt, "select": "*"}),
        db.select("intl_drug_approvals", {"drug_id": flt, "select": "*"}),
    )
    by_id = {d["id"]: d for d in drugs}
    out = []
    for i in id_list:
        if i in by_id:
            d = by_id[i]
            out.append({**d, "orphan_label": di.orphan_label(d), "matrix": _matrix([a for a in approvals if a["drug_id"] == i])})
    return {"drugs": out, "notice": "Side-by-side regulatory facts only. This does not imply clinical equivalence, "
                                    "interchangeability or any treatment recommendation."}


# ------------------------------------------------------------------ admin edits
class DrugIn(BaseModel):
    generic_name: str = Field(..., min_length=1, max_length=300)
    brand_names: list[str] = Field(default_factory=list, max_length=100)
    alternative_names: list[str] = Field(default_factory=list, max_length=100)
    kegg_drug_id: str | None = Field(None, pattern=r"^D\d{5}$")
    active_ingredient: str | None = None
    therapeutic_area: str | None = None
    sub_therapeutic_area: str | None = None
    drug_class: str | None = None
    atc_code: str | None = Field(None, max_length=20)
    dosage_form: str | None = None
    strength: str | None = None
    route: str | None = None
    manufacturer: str | None = None
    mah: str | None = None
    indication: str | None = None
    orphan_eu: bool | None = None
    orphan_us: bool | None = None
    orphan_jp: bool | None = None
    drug_type: str | None = None
    is_oncology: bool = False
    is_rare: bool = False
    source_url: str | None = Field(None, pattern=r"^https?://")
    verification_status: str = Field("Verified", pattern="^(Verified|Source-imported|Needs Review|Not Verified)$")


@router.post("/drugs")
async def create_drug(body: DrugIn, request: Request, user: CurrentUser = Depends(admin_only)):
    key = di.match_key(body.generic_name)
    if not key:
        raise HTTPException(400, "Generic name is required")
    db = user.db()
    existing, _ = await db.select("intl_drugs", {"match_key": f"eq.{key}", "select": "id,generic_name"})
    if existing:
        raise HTTPException(409, f"This medicine already exists as {existing[0]['id']} ({existing[0]['generic_name']})")
    row = {**body.model_dump(), "match_key": key, "generic_name": body.generic_name.strip(), "locked": True, "created_by": user.email}
    created = await db.insert("intl_drugs", row, returning="id")
    await audit("Drug created", user, "intl_drugs", created[0]["id"], {"generic_name": body.generic_name}, request)
    return created[0]


@router.put("/drugs/{drug_id}")
async def update_drug(drug_id: str, body: DrugIn, request: Request, user: CurrentUser = Depends(admin_only)):
    _drug_id(drug_id)
    db = user.db()
    old = await _drug(db, drug_id)
    data = body.model_dump()
    key = di.match_key(body.generic_name)
    if key != old["match_key"]:
        clash, _ = await db.select("intl_drugs", {"match_key": f"eq.{key}", "id": f"neq.{drug_id}", "select": "id"})
        if clash:
            raise HTTPException(409, f"Another record ({clash[0]['id']}) already uses this generic name")
        data["match_key"] = key
    changes = {k: {"from": old.get(k), "to": v} for k, v in data.items() if old.get(k) != v}
    await db.update("intl_drugs", [("id", f"eq.{drug_id}")], {**data, "locked": True})
    await audit("Drug record edited", user, "intl_drugs", drug_id, {"changes": changes}, request)
    return {"ok": True, "changed": list(changes)}


class ApprovalIn(BaseModel):
    approval_status: str
    approval_date: date | None = None
    authority: str | None = None
    application_number: str | None = None
    ma_number: str | None = None
    approval_type: str | None = None
    indication_approved: str | None = None
    label_url: str | None = Field(None, pattern=r"^https?://")
    source_url: str | None = Field(None, pattern=r"^https?://")
    marketing_status: str | None = None
    source_checked: str | None = None
    search_terms: str | None = None
    verification_notes: str | None = None
    lock: bool = True


@router.put("/drugs/{drug_id}/approvals/{country}")
async def set_approval(drug_id: str, country: str, body: ApprovalIn, request: Request, user: CurrentUser = Depends(admin_only)):
    """Record a manual verification for one jurisdiction (kept in the history)."""
    _drug_id(drug_id)
    code = di.country_code(country) or (country.upper() if re.fullmatch(r"[A-Za-z]{2}", country) else None)
    if not code:
        raise HTTPException(400, "Unknown country")
    if body.approval_status not in di.STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(di.STATUSES)}")
    if body.approval_status != "Not Verified" and not body.source_url:
        raise HTTPException(400, "Add the official source link you checked")
    if body.approval_status != "Not Verified" and not body.search_terms:
        raise HTTPException(400, "Add the search terms you used")
    db = user.db()
    await _drug(db, drug_id)
    name, region, authority = di.country_meta(code)
    data = {**body.model_dump(exclude={"lock"}), "approval_date": body.approval_date.isoformat() if body.approval_date else None,
            "authority": body.authority or authority, "region": region, "last_verified_date": date.today().isoformat(),
            "verified_by": user.email, "data_origin": "Manual", "locked": body.lock}
    existing, _ = await db.select("intl_drug_approvals", {"drug_id": f"eq.{drug_id}", "country": f"eq.{code}", "select": "id,approval_status"})
    if existing:
        await db.update("intl_drug_approvals", [("id", f"eq.{existing[0]['id']}")], data)
    else:
        await db.insert("intl_drug_approvals", {**data, "drug_id": drug_id, "country": code})
    await audit("Drug approval verified", user, "intl_drug_approvals", drug_id,
                {"country": code, "status": body.approval_status, "previous": existing[0]["approval_status"] if existing else None,
                 "source": body.source_url}, request)
    return {"ok": True}


class IndicationIn(BaseModel):
    indication: str = Field(..., min_length=3, max_length=8000)
    country: str = Field(..., pattern="^[A-Z]{2}$")
    disease_category: str | None = None
    therapeutic_area: str | None = None
    approval_status: str | None = None
    approval_date: date | None = None
    source_url: str = Field(..., pattern=r"^https?://")


@router.post("/drugs/{drug_id}/indications")
async def add_indication(drug_id: str, body: IndicationIn, request: Request, user: CurrentUser = Depends(admin_only)):
    _drug_id(drug_id)
    if body.approval_status and body.approval_status not in di.STATUSES:
        raise HTTPException(400, "Unknown approval status")
    data = {**body.model_dump(), "drug_id": drug_id, "verification_status": "Verified",
            "approval_date": body.approval_date.isoformat() if body.approval_date else None}
    await user.db().insert("intl_drug_indications", data, on_conflict="drug_id,country,indication_hash", resolution="merge-duplicates")
    await audit("Drug indication added", user, "intl_drugs", drug_id, {"country": body.country}, request)
    return {"ok": True}


# ------------------------------------------------------------------ doctor–drug mapping
DOCTOR_COLS = "id,doctor_name,specialty,sub_department,institute,city,state,country,department,category,email"


@router.get("/drugs/{drug_id}/doctors")
async def drug_doctors(
    drug_id: str,
    mode: str = Query("suggested", pattern="^(suggested|mapped|all)$"),
    department: str | None = None, category: str | None = Query(None, pattern="^([ABC]|none)$"),
    group_id: str | None = None, state: str | None = None, institute: str | None = None, q: str | None = None,
    specialty: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
):
    """Doctors for a medicine. 'suggested' = specialty-based relevance that needs human confirmation."""
    _drug_id(drug_id)
    db = user.db()
    drug = await _drug(db, drug_id)
    mapped_rows = await db.select_all("doctor_drug_mappings", [("drug_id", f"eq.{drug_id}"), ("select", "doctor_id,basis,created_by,created_at")])
    mapped = {m["doctor_id"]: m for m in mapped_rows}
    params: list[tuple[str, str]] = [("select", DOCTOR_COLS), ("order", "doctor_name.asc")]
    depts = user.ensure_department(department) if department else user.departments
    params.append(("department", "in.(" + ",".join(depts) + ")"))
    specs = di.relevant_specialties(drug)
    if mode == "suggested":
        tokens = [t for label, _ in specs for t in SPECIALTY_TOKENS.get(label, [])]
        if not tokens:
            return {"items": [], "total": 0, "specialties": [], "mapped_total": len(mapped),
                    "notice": "No specialty rule matches this medicine's therapeutic coding. Use 'All doctors' to map manually."}
        params.append(("or", "(" + ",".join(f"{col}.ilike.*{t}*" for t in tokens for col in ("specialty", "sub_department")) + ")"))
    elif mode == "mapped":
        if not mapped:
            return {"items": [], "total": 0, "specialties": [s for s, _ in specs], "mapped_total": 0}
        params.append(("id", "in.(" + ",".join(list(mapped)[:1000]) + ")"))
    if category:
        params.append(("category", "is.null" if category == "none" else f"eq.{category}"))
    if state:
        params.append(("state", f"ilike.*{_clean_q(state)}*"))
    if institute:
        params.append(("institute", f"ilike.*{_clean_q(institute)}*"))
    if specialty:
        params.append(("specialty", f"ilike.*{_clean_q(specialty)}*"))
    if q:
        params.append(("doctor_name", f"ilike.*{_clean_q(q)}*"))
    if group_id:
        if not UUID_RE.match(group_id):
            raise HTTPException(400, "Invalid group")
        members = await db.select_all("doctor_group_members", [("group_id", f"eq.{group_id}"), ("select", "doctor_id")])
        if not members:
            return {"items": [], "total": 0, "specialties": [s for s, _ in specs], "mapped_total": len(mapped)}
        params.append(("id", "in.(" + ",".join(m["doctor_id"] for m in members[:1000]) + ")"))
    rows, total = await db.select("doctors", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    for r in rows:
        r["mapped"] = r["id"] in mapped
        r["mapping"] = mapped.get(r["id"])
        r["reason"] = di.specialty_reason(drug, r.get("specialty"), r.get("sub_department"))
    return {"items": rows, "total": total or 0, "specialties": [s for s, _ in specs], "mapped_total": len(mapped),
            "notice": "Suggestions are based on specialty only and do not mean the doctor prescribes this medicine. Confirm each one."}


class MappingIn(BaseModel):
    drug_ids: list[str] = Field(..., min_length=1, max_length=50)
    doctor_ids: list[str] = Field(..., min_length=1, max_length=2000)
    basis: str | None = Field(None, max_length=200)
    notes: str | None = Field(None, max_length=1000)


@router.post("/mappings")
async def add_mappings(body: MappingIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    for d in body.drug_ids:
        _drug_id(d)
    bad = [i for i in body.doctor_ids if not UUID_RE.match(i)]
    if bad:
        raise HTTPException(400, "Invalid doctor id")
    if len(body.drug_ids) * len(body.doctor_ids) > 10000:
        raise HTTPException(400, "Too many combinations at once (max 10,000)")
    db = user.db()
    rows = [{"drug_id": d, "doctor_id": doc, "basis": body.basis or "Confirmed by user", "notes": body.notes, "created_by": user.email}
            for d in dict.fromkeys(body.drug_ids) for doc in dict.fromkeys(body.doctor_ids)]
    try:
        for i in range(0, len(rows), 1000):
            await db.insert("doctor_drug_mappings", rows[i:i + 1000], on_conflict="doctor_id,drug_id", resolution="ignore-duplicates")
    except SupabaseError as exc:
        if "row-level security" in exc.message or exc.status == 403:
            raise HTTPException(403, "You can only map doctors from your own department") from exc
        raise
    await audit("Doctor–drug mapping added", user, "doctor_drug_mappings", None,
                {"drugs": body.drug_ids, "doctors": len(body.doctor_ids)}, request)
    return {"ok": True, "mapped": len(rows)}


class UnmapIn(BaseModel):
    drug_id: str
    doctor_ids: list[str] = Field(..., min_length=1, max_length=2000)


@router.post("/mappings/remove")
async def remove_mappings(body: UnmapIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    _drug_id(body.drug_id)
    if any(not UUID_RE.match(i) for i in body.doctor_ids):
        raise HTTPException(400, "Invalid doctor id")
    await user.db().delete("doctor_drug_mappings", [("drug_id", f"eq.{body.drug_id}"), ("doctor_id", "in.(" + ",".join(body.doctor_ids) + ")")])
    await audit("Doctor–drug mapping removed", user, "doctor_drug_mappings", body.drug_id, {"doctors": len(body.doctor_ids)}, request)
    return {"ok": True}


@router.get("/doctors/{doctor_id}/drugs")
async def doctor_drugs(doctor_id: str, user: CurrentUser = Depends(get_current_user)):
    if not UUID_RE.match(doctor_id):
        raise HTTPException(400, "Invalid doctor id")
    rows, _ = await user.db().select("doctor_drug_mappings", {
        "doctor_id": f"eq.{doctor_id}", "order": "created_at.desc",
        "select": "id,basis,created_by,created_at,drug:intl_drugs(id,generic_name,brand_names,therapeutic_area)"})
    return {"items": rows}


class GroupFromMapping(BaseModel):
    drug_id: str
    name: str = Field(..., min_length=1, max_length=120)
    department: str = "NPP"


@router.post("/mappings/group")
async def group_from_mapping(body: GroupFromMapping, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Create a doctor group (therapeutic interest) from the doctors mapped to a medicine."""
    _drug_id(body.drug_id)
    user.ensure_department(body.department)
    db = user.db()
    drug = await _drug(db, body.drug_id)
    mapped = await db.select_all("doctor_drug_mappings", [("drug_id", f"eq.{body.drug_id}"), ("select", "doctor_id")])
    ids = [m["doctor_id"] for m in mapped]
    if not ids:
        raise HTTPException(400, "No doctors are mapped to this medicine yet")
    docs = []
    for i in range(0, len(ids), 300):
        part, _ = await db.select("doctors", {"id": "in.(" + ",".join(ids[i:i + 300]) + ")", "department": f"eq.{body.department}", "select": "id"})
        docs += part
    if not docs:
        raise HTTPException(400, f"None of the mapped doctors belong to {body.department}")
    try:
        group = await db.insert("doctor_groups", {"name": body.name.strip(), "department": body.department,
                                                  "description": f"Doctors mapped to {drug['generic_name']} ({drug['id']})",
                                                  "filters": {"drug_id": drug["id"]}}, returning="id")
    except SupabaseError as exc:
        if exc.status == 409:
            raise HTTPException(409, "A group with this name already exists") from exc
        raise
    await db.insert("doctor_group_members", [{"group_id": group[0]["id"], "doctor_id": d["id"]} for d in docs],
                    on_conflict="group_id,doctor_id", resolution="ignore-duplicates")
    await audit("Doctor group created from drug mapping", user, "doctor_groups", group[0]["id"], {"drug_id": drug["id"], "members": len(docs)}, request)
    return {"id": group[0]["id"], "members": len(docs)}


@router.get("/mappings/export")
async def export_mapped_doctors(drug_ids: str, request: Request, user: CurrentUser = Depends(get_current_user)):
    ids = [_drug_id(i.strip()) for i in drug_ids.split(",") if i.strip()][:50]
    if not ids:
        raise HTTPException(400, "Choose at least one medicine")
    db = user.db()
    rows = await db.select_all("doctor_drug_mappings", [
        ("drug_id", "in.(" + ",".join(ids) + ")"), ("order", "drug_id.asc"),
        ("select", "drug_id,basis,created_by,created_at,drug:intl_drugs(generic_name),doctor:doctors(doctor_name,specialty,institute,city,state,department,category,email,whatsapp_number)")])
    rows = [r for r in rows if r.get("doctor")]  # RLS hides other departments' doctors
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Drug_ID", "Medicine", "Doctor", "Specialty", "Institute", "City", "State", "Department", "Category", "Email", "WhatsApp", "Mapping basis", "Mapped by", "Mapped on"])
    for r in rows:
        d = r["doctor"]
        w.writerow([r["drug_id"], (r.get("drug") or {}).get("generic_name"), d.get("doctor_name"), d.get("specialty"), d.get("institute"),
                    d.get("city"), d.get("state"), d.get("department"), d.get("category") or "", d.get("email"), d.get("whatsapp_number"),
                    r.get("basis"), r.get("created_by"), (r.get("created_at") or "")[:10]])
    await audit("Mapped doctors exported", user, "doctor_drug_mappings", None, {"drugs": ids, "rows": len(rows)}, request)
    return _csv_response(buf.getvalue(), "ikris-doctors-by-medicine.csv")


# ------------------------------------------------------------------ NPP drug requests
class RequestIn(BaseModel):
    patient_reference_id: str | None = Field(None, max_length=40)
    doctor_id: str | None = None
    drug_id: str | None = None
    requested_drug_name: str = Field(..., min_length=1, max_length=300)
    generic_name: str | None = None
    brand_name: str | None = None
    strength: str | None = None
    dosage_form: str | None = None
    required_country: str | None = None
    treating_doctor: str | None = None
    request_date: date | None = None
    request_status: str = "New"
    regulatory_check_status: str = "Not started"
    approval_check: str = "Not checked"
    marketing_check: str = "Not checked"
    stock_check: str = "Not checked"
    import_check: str = "Not checked"
    patient_permission_check: str = "Not checked"
    assigned_department: str | None = None
    remarks: str | None = Field(None, max_length=4000)


def _check_request(body: RequestIn, user: CurrentUser) -> dict:
    if body.patient_reference_id and not re.fullmatch(r"[A-Za-z0-9/_-]{1,40}", body.patient_reference_id):
        raise HTTPException(400, "Patient reference must be a code (letters, numbers, - _ /), never the patient's name")
    if body.doctor_id and not UUID_RE.match(body.doctor_id):
        raise HTTPException(400, "Invalid doctor id")
    if body.drug_id:
        _drug_id(body.drug_id)
    if body.request_status not in REQUEST_STATUSES:
        raise HTTPException(400, "Unknown request status")
    if body.regulatory_check_status not in REG_CHECK:
        raise HTTPException(400, "Unknown regulatory check status")
    for f in ("approval_check", "marketing_check", "stock_check", "import_check", "patient_permission_check"):
        if getattr(body, f) not in CHECK_VALUES:
            raise HTTPException(400, f"Unknown value for {f}")
    dept = body.assigned_department or (user.role if not user.is_admin else "NPP")
    user.ensure_department(dept)
    data = body.model_dump()
    data["assigned_department"] = dept
    data["request_date"] = (body.request_date or date.today()).isoformat()
    return data


REQ_SELECT = "*,drug:intl_drugs(id,generic_name,brand_names),doctor:doctors(id,doctor_name,specialty,institute)"


@router.get("/requests")
async def list_requests(
    status: str | None = None, drug_id: str | None = None, department: str | None = None, q: str | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), user: CurrentUser = Depends(get_current_user),
):
    params: list[tuple[str, str]] = [("select", REQ_SELECT), ("order", "request_date.desc,id.desc")]
    if status:
        params.append(("request_status", f"eq.{status}"))
    if drug_id:
        params.append(("drug_id", f"eq.{_drug_id(drug_id)}"))
    if department:
        user.ensure_department(department)
        params.append(("assigned_department", f"eq.{department}"))
    if q:
        c = _clean_q(q)
        params.append(("or", f"(requested_drug_name.ilike.*{c}*,generic_name.ilike.*{c}*,brand_name.ilike.*{c}*,id.ilike.*{c}*,treating_doctor.ilike.*{c}*)"))
    rows, total = await user.db().select("npp_drug_requests", params, count=True, offset=(page - 1) * page_size, limit=page_size)
    counts = await user.db().select_all("npp_drug_requests", [("select", "request_status")])
    by_status: dict[str, int] = {}
    for r in counts:
        by_status[r["request_status"]] = by_status.get(r["request_status"], 0) + 1
    return {"items": rows, "total": total or 0, "by_status": by_status}


@router.get("/requests/{request_id}")
async def get_request(request_id: str, user: CurrentUser = Depends(get_current_user)):
    if not REQ_ID.match(request_id):
        raise HTTPException(400, "Invalid request id")
    db = user.db()
    rows, _ = await db.select("npp_drug_requests", {"id": f"eq.{request_id}", "select": REQ_SELECT})
    if not rows:
        raise HTTPException(404, "Request not found")
    req = rows[0]
    regulatory = None
    if req.get("drug_id"):
        approvals, _ = await db.select("intl_drug_approvals", {"drug_id": f"eq.{req['drug_id']}", "select": "*"})
        regulatory = _matrix(approvals)
    hist, _ = await db.select("audit_logs", {"entity": "eq.npp_drug_requests", "entity_id": f"eq.{request_id}",
                                             "select": "action,user_email,details,created_at", "order": "created_at.desc", "limit": "50"})
    return {"request": req, "regulatory": regulatory, "history": hist}


@router.post("/requests")
async def create_request(body: RequestIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    data = _check_request(body, user)
    created = await user.db().insert("npp_drug_requests", {**data, "created_by": user.email}, returning="id")
    await audit("NPP drug request created", user, "npp_drug_requests", created[0]["id"],
                {"drug_id": body.drug_id, "country": body.required_country, "status": body.request_status}, request)
    return created[0]


@router.put("/requests/{request_id}")
async def update_request(request_id: str, body: RequestIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    if not REQ_ID.match(request_id):
        raise HTTPException(400, "Invalid request id")
    db = user.db()
    old, _ = await db.select("npp_drug_requests", {"id": f"eq.{request_id}", "select": "*"})
    if not old:
        raise HTTPException(404, "Request not found")
    data = _check_request(body, user)
    changes = {k: {"from": old[0].get(k), "to": v} for k, v in data.items()
               if str(old[0].get(k) or "") != str(v or "") and k != "patient_reference_id"}
    if str(old[0].get("patient_reference_id") or "") != str(data.get("patient_reference_id") or ""):
        changes["patient_reference_id"] = "changed"  # the reference itself is not copied into the audit log
    await db.update("npp_drug_requests", [("id", f"eq.{request_id}")], {**data, "updated_at": datetime.now(timezone.utc).isoformat()})
    await audit("NPP drug request updated", user, "npp_drug_requests", request_id, {"changes": changes}, request)
    return {"ok": True}


# ------------------------------------------------------------------ import
async def _start_run(db: PostgREST, source: str, user: CurrentUser) -> str:
    run = await db.insert("intl_import_runs", {"source": source, "started_by": user.email}, returning="id")
    return run[0]["id"]


async def _finish_run(db: PostgREST, run_id: str, counts: dict, errors: list, failed: bool = False) -> None:
    status = "failed" if failed else ("partial" if errors else "success")
    await db.update("intl_import_runs", [("id", f"eq.{run_id}")], {
        "status": status, "counts": counts, "errors": errors[:200], "finished_at": datetime.now(timezone.utc).isoformat()})


async def _push(db: PostgREST, origin: str, rows: list[dict], actor: str) -> tuple[dict, list]:
    totals: dict[str, int] = {}
    errors: list = []
    sem = asyncio.Semaphore(3)

    async def one(batch: list[dict]):
        async with sem:
            return await db.rpc("intl_import", {"p_origin": origin, "p_rows": batch, "p_actor": actor})

    results = await asyncio.gather(*(one(rows[i:i + IMPORT_BATCH]) for i in range(0, len(rows), IMPORT_BATCH)), return_exceptions=True)
    for res in results:
        if isinstance(res, Exception):
            errors.append({"name": "batch", "error": str(res)[:300]})
            continue
        errors += res.pop("errors", [])
        for k, v in res.items():
            totals[k] = totals.get(k, 0) + int(v)
    return totals, errors


async def _download(url: str, timeout: float = 40.0) -> bytes:
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0), follow_redirects=True,
                                 headers={"User-Agent": "IKRIS-Doctor-Connect/1.0 (regulatory reference import)"}) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r.content


async def _run_ema(request: Request, user: CurrentUser, content: bytes | None) -> dict:
    db = user.db()
    run_id = await _start_run(db, "EMA" if content is None else "EMA (uploaded file)", user)
    try:
        rows, parse_errors = di.parse_ema(content if content is not None else await _download(di.EMA_FILE_URL))
        counts, errors = await _push(db, "EMA", rows, f"EMA import by {user.email}")
    except httpx.HTTPStatusError as exc:
        msg = ("EMA asked us to slow down (too many downloads). Try again in an hour, or download the file from the EMA page and upload it here."
               if exc.response.status_code == 429 else f"EMA returned HTTP {exc.response.status_code}")
        await _finish_run(db, run_id, {}, [{"name": "EMA file", "error": msg}], failed=True)
        raise HTTPException(502, msg) from exc
    except Exception as exc:  # noqa: BLE001 - recorded on the run and shown to the admin
        await _finish_run(db, run_id, {}, [{"name": "EMA file", "error": str(exc)[:300]}], failed=True)
        raise HTTPException(502, f"EMA import failed: {exc}") from exc
    counts["substances_in_file"] = len(rows)
    await _finish_run(db, run_id, counts, parse_errors + errors)
    await audit("Drug import (EMA)", user, "intl_import_runs", run_id, counts, request)
    return {"run_id": run_id, "counts": counts, "errors": (parse_errors + errors)[:50], "credit": di.EMA_CREDIT}


@router.post("/import/ema")
async def import_ema(request: Request, user: CurrentUser = Depends(admin_only)):
    return await _run_ema(request, user, None)


@router.post("/import/ema-file")
async def import_ema_file(request: Request, file: UploadFile = File(...), user: CurrentUser = Depends(admin_only)):
    """Same as /import/ema with the 'Medicines' Excel file downloaded by hand from the EMA website."""
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "File too large")
    return await _run_ema(request, user, content)


@router.post("/import/fda")
async def import_fda(request: Request, user: CurrentUser = Depends(admin_only)):
    db = user.db()
    run_id = await _start_run(db, "openFDA", user)
    try:
        index = await _download(di.FDA_DOWNLOAD_INDEX, 20)
        import json as _json
        part = _json.loads(index)["results"]["drug"]["drugsfda"]
        export_date = part.get("export_date")
        zbytes = await _download(part["partitions"][0]["file"], 45)
        label_rows = await db.select_all("fda_drugs", [("select", "application_number,indication,label_url,therapeutic_areas")])
        labels = {r["application_number"]: r for r in label_rows if r.get("application_number")}
        rows, parse_errors = di.parse_fda(zbytes, labels, export_date)
        counts, errors = await _push(db, "openFDA", rows, f"openFDA import by {user.email}")
    except Exception as exc:  # noqa: BLE001
        await _finish_run(db, run_id, {}, [{"name": "openFDA", "error": str(exc)[:300]}], failed=True)
        raise HTTPException(502, f"openFDA import failed: {exc}") from exc
    counts["substances_in_file"] = len(rows)
    await _finish_run(db, run_id, counts, parse_errors + errors)
    await audit("Drug import (openFDA)", user, "intl_import_runs", run_id, counts, request)
    return {"run_id": run_id, "counts": counts, "errors": (parse_errors + errors)[:50]}


async def _apply_table(user: CurrentUser, kind: str, raw: list[dict[str, str]], apply: bool, source: str, request: Request) -> dict:
    db = user.db()
    if kind == "approvals":
        ok, bad = di.validate_approval_rows(raw, user.email)
        # Show which existing record each row matches (duplicate detection) before applying.
        keys = sorted({r["match_key"] for r in ok if r.get("match_key") and not r.get("drug_id")})
        known: dict[str, str] = {}
        for i in range(0, len(keys), 100):
            part, _ = await db.select("intl_drugs", {"match_key": "in.(" + ",".join('"' + k.replace('"', "") + '"' for k in keys[i:i + 100]) + ")", "select": "id,match_key"})
            known |= {p["match_key"]: p["id"] for p in part}
        ids = sorted({r["drug_id"] for r in ok if r.get("drug_id")})
        found_ids: set[str] = set()
        for i in range(0, len(ids), 100):
            part, _ = await db.select("intl_drugs", {"id": "in.(" + ",".join(ids[i:i + 100]) + ")", "select": "id"})
            found_ids |= {p["id"] for p in part}
        preview = []
        for r in ok:
            if r.get("drug_id"):
                target = r["drug_id"] if r["drug_id"] in found_ids else None
                if not target:
                    bad.append({"row": r["row"], "name": r["drug_id"], "errors": ["Drug_ID not found"]})
                    continue
            else:
                target = known.get(r["match_key"])
            preview.append({"row": r["row"], "name": r.get("generic_name") or r.get("drug_id"), "matches": target or "new record",
                            "country": r["approval"]["country"], "status": r["approval"]["approval_status"]})
        valid = [r for r in ok if not any(b["row"] == r["row"] for b in bad)]
        result: dict[str, Any] = {"valid": len(valid), "invalid": len(bad), "errors": bad[:100], "preview": preview[:200]}
        if apply and valid:
            run_id = await _start_run(db, source, user)
            for r in valid:
                r.pop("row", None)
            counts, errors = await _push(db, "CSV import", valid, f"{source} by {user.email}")
            # Rows checked by a person are protected from later automatic source imports.
            codes = sorted({r["approval"]["country"] for r in valid})
            await db.update("intl_drug_approvals", [("data_origin", "eq.CSV import"), ("locked", "is.false"),
                                                    ("country", "in.(" + ",".join(codes) + ")")], {"locked": True})
            await _finish_run(db, run_id, counts, errors + bad)
            await audit("Drug approvals imported", user, "intl_import_runs", run_id, counts, request)
            result |= {"applied": True, "counts": counts, "apply_errors": errors[:50]}
        return result

    # master tab: update existing Drug_IDs field by field; rows without Drug_ID create new records
    bad, updates, creates = [], [], []
    for i, r in enumerate(raw, start=2):
        patch, problems = di.master_patch(r)
        did = (r.get("drug_id") or "").strip()
        if did and not DRUG_ID.match(did):
            problems.append("Drug_ID must look like IDI-000123")
        if not did and not patch.get("generic_name"):
            problems.append("Generic_Name is required for a new record")
        if problems:
            bad.append({"row": i, "name": did or patch.get("generic_name"), "errors": problems})
        elif did:
            updates.append((i, did, patch))
        else:
            creates.append((i, patch))
    result = {"valid": len(updates) + len(creates), "invalid": len(bad), "errors": bad[:100],
              "preview": [{"row": i, "name": d, "matches": d, "fields": sorted(p)} for i, d, p in updates[:100]]
                         + [{"row": i, "name": p["generic_name"], "matches": "new record (or existing with same generic name)"} for i, p in creates[:100]]}
    if apply:
        run_id = await _start_run(db, source, user)
        done, errors = 0, []
        for i, did, patch in updates:
            if "generic_name" in patch:
                patch["match_key"] = di.match_key(patch["generic_name"])
            try:
                res = await db.update("intl_drugs", [("id", f"eq.{did}")], {**patch, "locked": True}, returning="id")
                if res:
                    done += 1
                else:
                    errors.append({"row": i, "name": did, "error": "Drug_ID not found"})
            except SupabaseError as exc:
                errors.append({"row": i, "name": did, "error": exc.message})
        counts = {"drugs_updated": done}
        if creates:
            rows = [{**p, "match_key": di.match_key(p["generic_name"]), "brand_names": p.get("brand_names", [])} for _, p in creates]
            c2, e2 = await _push(db, "CSV import", rows, f"{source} by {user.email}")
            counts |= c2
            errors += e2
        await _finish_run(db, run_id, counts, errors + bad)
        await audit("Drug master imported", user, "intl_import_runs", run_id, counts, request)
        result |= {"applied": True, "counts": counts, "apply_errors": errors[:50]}
    return result


@router.post("/import/file")
async def import_file(
    request: Request, file: UploadFile = File(...), kind: str = Form(..., pattern="^(approvals|master)$"),
    apply: bool = Form(False), user: CurrentUser = Depends(admin_only),
):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10 MB)")
    try:
        raw = di.read_table(content, file.filename or "")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the file: {exc}") from exc
    if not raw:
        raise HTTPException(400, "The file has no data rows")
    if len(raw) > 5000:
        raise HTTPException(400, "Up to 5,000 rows per file")
    return await _apply_table(user, kind, raw, apply, f"File: {file.filename}", request)


class SheetImport(BaseModel):
    url: str = Field(..., pattern=r"^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]+")
    tab: str = Field(..., min_length=1, max_length=100)
    kind: str = Field(..., pattern="^(approvals|master)$")
    apply: bool = False


@router.post("/import/sheet")
async def import_sheet(body: SheetImport, request: Request, user: CurrentUser = Depends(admin_only)):
    """Read a tab (Drug_Country_Approval or International_Drug_Master) from a Google Sheet shared 'anyone with the link'."""
    sheet_id = re.search(r"/d/([A-Za-z0-9_-]+)", body.url).group(1)  # type: ignore[union-attr]
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq"
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
            r = await c.get(url, params={"tqx": "out:csv", "sheet": body.tab})
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not reach Google Sheets: {exc}") from exc
    if r.status_code != 200 or "text/html" in r.headers.get("content-type", ""):
        raise HTTPException(400, "Could not read that tab. Share the sheet as 'Anyone with the link can view' and check the tab name.")
    raw = di.read_table(r.content, "sheet.csv")
    if not raw:
        raise HTTPException(400, "That tab has no data rows")
    return await _apply_table(user, body.kind, raw, body.apply, f"Google Sheet tab {body.tab}", request)


@router.get("/import/runs")
async def import_runs(user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("intl_import_runs", {"select": "*", "order": "started_at.desc", "limit": "30"})
    return {"items": rows, "sources": {
        "openFDA": "https://open.fda.gov/data/downloads/",
        "EMA": di.EMA_PAGE_URL,
        "PMDA": "https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0001.html",
        "KEGG": "https://www.genome.jp/kegg/legal.html",
    }}


# ------------------------------------------------------------------ export (sheet-tab layout)
def _csv_response(text: str, filename: str) -> StreamingResponse:
    return StreamingResponse(iter(["﻿" + text]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _master_row(d: dict) -> list:
    return [d["id"], d.get("kegg_drug_id"), d["generic_name"], "; ".join(d.get("brand_names") or []),
            "; ".join(d.get("alternative_names") or []), d.get("active_ingredient"), "; ".join(d.get("combination_ingredients") or []),
            d.get("therapeutic_area"), d.get("sub_therapeutic_area"), d.get("drug_class"), d.get("atc_code"), d.get("dosage_form"),
            d.get("strength"), d.get("route"), d.get("manufacturer"), d.get("mah"), (d.get("indication") or "")[:5000],
            di.orphan_label(d), d.get("drug_type"), d.get("source_url"), (d.get("created_at") or "")[:10], (d.get("updated_at") or "")[:10],
            d.get("verification_status")]


async def _tab_rows(user: CurrentUser, tab: str, drug_ids: list[str] | None) -> tuple[list[str], list[list]]:
    db = user.db()

    async def fetch(table: str, select: str, order: str, key: str = "drug_id") -> list[dict]:
        if drug_ids is None:
            return await db.select_all(table, [("select", select), ("order", order)])
        out: list[dict] = []
        for i in range(0, len(drug_ids), 200):
            out += await db.select_all(table, [("select", select), ("order", order), (key, "in.(" + ",".join(drug_ids[i:i + 200]) + ")")])
        return out

    if tab == "master":
        rows = await fetch("intl_drugs", "*", "id.asc", "id")
        return di.MASTER_COLUMNS, [_master_row(d) for d in rows]
    if tab == "approvals":
        rows = await fetch("intl_drug_approvals", "*,drug:intl_drugs(generic_name,brand_names)", "drug_id.asc,country.asc")
        return di.APPROVAL_COLUMNS, [[a["id"], a["drug_id"], (a.get("drug") or {}).get("generic_name"), "; ".join((a.get("drug") or {}).get("brand_names") or [])[:500],
                                      a["region"], a["country"], a.get("authority"), a["approval_status"], a.get("approval_date"),
                                      a.get("application_number"), a.get("ma_number"), a.get("approval_type"), (a.get("indication_approved") or "")[:5000],
                                      a.get("label_url"), a.get("source_url"), a.get("last_verified_date"), a.get("verified_by"),
                                      a.get("verification_notes"), a.get("search_terms"), a.get("source_checked"), a.get("marketing_status")] for a in rows]
    if tab == "indications":
        rows = await fetch("intl_drug_indications", "*,drug:intl_drugs(generic_name)", "drug_id.asc")
        return di.INDICATION_COLUMNS, [[r["drug_id"], (r.get("drug") or {}).get("generic_name"), r["indication"][:5000], r.get("disease_category"),
                                        r.get("therapeutic_area"), r["country"], r.get("approval_status"), r.get("approval_date"),
                                        r.get("source_url"), r.get("verification_status")] for r in rows]
    if tab == "history":
        rows = await fetch("intl_drug_history", "*", "updated_on.desc")
        return di.HISTORY_COLUMNS, [[r["id"], r["drug_id"], r.get("country"), r.get("authority"), r.get("previous_status"), r.get("new_status"),
                                     r.get("effective_date"), r.get("description"), r.get("source_url"), (r.get("updated_on") or "")[:19]] for r in rows]
    rows = await fetch("npp_drug_requests", "*", "request_date.desc")
    return di.REQUEST_COLUMNS, [[r["id"], r.get("patient_reference_id"), r.get("doctor_id"), r.get("drug_id"), r["requested_drug_name"],
                                 r.get("generic_name"), r.get("brand_name"), r.get("strength"), r.get("dosage_form"), r.get("required_country"),
                                 r.get("treating_doctor"), r.get("request_date"), r["request_status"], r["regulatory_check_status"],
                                 r["assigned_department"], r.get("remarks")] for r in rows]


TAB_NAMES = {"master": "International_Drug_Master", "approvals": "Drug_Country_Approval", "indications": "Drug_Indications",
             "history": "Drug_Regulatory_History", "requests": "NPP_Drug_Requests"}


@router.get("/export")
async def export(
    request: Request,
    tab: str = Query("master", pattern="^(master|approvals|indications|history|requests|all)$"),
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    filtered: bool = False,
    f: ListFilters = Depends(list_filters),
    user: CurrentUser = Depends(get_current_user),
):
    """Export in the Google Sheets tab layout. With filtered=true only drugs matching the current filters."""
    drug_ids = None
    if filtered and tab != "requests":
        rows = await user.db().select_all("intl_drug_overview", overview_filters(f) + [("select", "id"), ("order", "id.asc")])
        drug_ids = [r["id"] for r in rows]
    tabs = list(TAB_NAMES) if tab == "all" else [tab]
    if format == "csv" and len(tabs) > 1:
        raise HTTPException(400, "Use Excel to export all tabs together")
    stamp = date.today().isoformat()
    if format == "csv":
        cols, rows = await _tab_rows(user, tabs[0], drug_ids)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols)
        w.writerows([["" if v is None else v for v in r] for r in rows])
        await audit("Drug data exported", user, "intl_drugs", None, {"tab": tab, "rows": len(rows), "filtered": filtered}, request)
        return _csv_response(buf.getvalue(), f"{TAB_NAMES[tabs[0]]}_{stamp}.csv")
    import openpyxl
    from openpyxl.styles import Font, PatternFill

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    total = 0
    for t in tabs:
        cols, rows = await _tab_rows(user, t, drug_ids)
        ws = wb.create_sheet(TAB_NAMES[t])
        ws.append(cols)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="5A3E2B")
        for r in rows:
            ws.append([("" if v is None else (str(v)[:32000] if isinstance(v, str) else v)) for v in r])
        ws.freeze_panes = "A2"
        total += len(rows)
    ws = wb.create_sheet("Sources")
    for line in (["Source", "Terms / note"],
                 ["European Medicines Agency (EMA)", di.EMA_CREDIT + " — " + di.EMA_PAGE_URL],
                 ["openFDA Drugs@FDA", "https://open.fda.gov/data/downloads/ (US Government public data)"],
                 ["Japan / UK / national registers", "Entered by Ikris staff from the official register named on each record"],
                 ["Status rule", "'Not Verified' or a missing record does not mean the medicine is unapproved"]):
        ws.append(line)
    out = io.BytesIO()
    wb.save(out)
    await audit("Drug data exported", user, "intl_drugs", None, {"tab": tab, "rows": total, "filtered": filtered, "format": "xlsx"}, request)
    return StreamingResponse(iter([out.getvalue()]),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="Ikris_Drug_Intelligence_{tab}_{stamp}.xlsx"'})


@router.get("/template")
async def template(kind: str = Query("approvals", pattern="^(approvals|master)$"), user: CurrentUser = Depends(get_current_user)):
    cols = di.APPROVAL_COLUMNS if kind == "approvals" else di.MASTER_COLUMNS
    buf = io.StringIO()
    csv.writer(buf).writerow(cols)
    return _csv_response(buf.getvalue(), f"{TAB_NAMES[kind]}_template.csv")


@router.get("/reports")
async def reports(user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    data, summary_ = await asyncio.gather(db.rpc("intl_reports"), db.rpc("intl_summary"))
    for r in data.get("by_country", []):
        r["name"] = di.country_meta(r["country"])[0]
    return {**data, "summary": summary_}


_ = DEPARTMENTS  # departments are validated through CurrentUser.ensure_department
