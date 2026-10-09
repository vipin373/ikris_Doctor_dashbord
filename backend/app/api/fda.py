"""FDA drug intelligence: drugs, sync, classification review, settings, doctor matching, bulk import."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field, model_validator

from ..core.config import get_settings
from ..core.security import CurrentUser, get_current_user, require_admin
from ..core.supabase import PostgREST, SupabaseError
from ..services import bulk_import, cdsco_service, fda_service, kegg_service
from ..services import ai_message_service as ai
from ..services.audit import audit
from ..services.doctor_matcher import DRUG_COLUMNS, areas_label, doctor_areas, eligibility, recommend
from ..services.drug_classifier import AREA_LABEL, AREAS, OTHER, verify_ai_classification
from ..services.message_render import VARIABLES
from ..services.whatsapp_service import ProviderNotConfigured

router = APIRouter(tags=["fda"])
LIST_DRUG_COLUMNS = (
    "id,application_number,drug_name,brand_name,generic_name,active_ingredient,manufacturer,therapeutic_area,"
    "therapeutic_areas,department,classification_status,fda_status,approval_date,marketing_status,fda_source,"
    "drugs_at_fda_url,label_url,last_synced_at,india_status,india_evidence"
)
INDIA_FILTER = {
    "not_approved": "in.(NOT_FOUND,MANUAL_NOT_APPROVED)",
    "approved": "in.(APPROVED,MANUAL_APPROVED)",
    "unknown": "eq.UNKNOWN",
    "not_checked": "is.null",
}


# ------------------------------------------------------------------ overview / config
@router.get("/api/fda/overview")
async def overview(user: CurrentUser = Depends(get_current_user)):
    return await user.db().rpc("fda_overview")


@router.get("/api/fda/config")
async def config_status(user: CurrentUser = Depends(get_current_user)):
    s = get_settings()
    return {
        "fda_api": s.fda_api_base_url,
        "fda_api_key": bool(s.fda_api_key),
        "openrouter": bool(s.openrouter_api_key),
        "openrouter_model": s.openrouter_model if s.openrouter_api_key else None,
        "cunnekt": bool(s.cunnekt_api_key),
        "email": not s.missing_email_config,
        "email_missing": s.missing_email_config,
        "kegg": kegg_service.enabled(),
        "variables": [{"name": n, "group": g, "description": d} for n, g, d in VARIABLES],
    }


# ------------------------------------------------------------------ drugs
@router.get("/api/fda/drugs")
async def list_drugs(
    q: str | None = None,
    department: str | None = Query(None, pattern="^(ONCOLOGY|HEMATOLOGY|RARE_DISEASE|OTHER|NEEDS_REVIEW)$"),
    area: str | None = Query(None, pattern="^(ONCOLOGY|HEMATOLOGY|RARE_DISEASE)$"),
    sendable: bool = False,
    india: Literal["not_approved", "approved", "unknown", "not_checked", "all"] = "not_approved",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    p: list[tuple[str, str]] = [("select", LIST_DRUG_COLUMNS), ("order", "drug_name.asc")]
    if sendable:
        india = "not_approved"
    if india != "all":
        p.append(("india_status", INDIA_FILTER[india]))
    if q and q.strip():
        term = q.strip().lower().replace("*", "").replace(",", " ")
        p.append(("search_text", f"ilike.*{term}*"))
    if department == "NEEDS_REVIEW":
        p.append(("classification_status", "eq.NEEDS_REVIEW"))
    elif department:
        p.append(("department", f"eq.{department}"))
    if area:
        p.append(("therapeutic_areas", f"cs.{{{area}}}"))
    if sendable:
        p += [("classification_status", "in.(CLASSIFIED,APPROVED)"), ("fda_status", "not.is.null")]
    rows, total = await user.db().select("fda_drugs", p, count=True, offset=(page - 1) * page_size, limit=page_size)
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/api/fda/drugs/{drug_id}")
async def get_drug(drug_id: str, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows, _ = await db.select("fda_drugs", {"id": f"eq.{drug_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Drug not found")
    drug = rows[0]
    drug.pop("search_text", None)
    drug.pop("record_hash", None)
    cls, _ = await db.select("drug_classifications", [("drug_id", f"eq.{drug_id}"), ("select", "*"),
                                                       ("order", "classified_at.desc"), ("limit", "10")])
    kegg, _ = await db.select("kegg_drugs", {"drug_id": f"eq.{drug_id}", "select": "*"})
    return {"drug": drug, "classifications": cls, "kegg": kegg[0] if kegg else None, "kegg_enabled": kegg_service.enabled()}


class ReviewIn(BaseModel):
    department: Literal["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE", "OTHER"]
    therapeutic_areas: list[Literal["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE", "OTHER"]] = Field(min_length=1, max_length=4)
    action: Literal["APPROVED", "REJECTED"] = "APPROVED"
    reason: str = Field(min_length=3, max_length=500)


@router.post("/api/fda/drugs/{drug_id}/classification")
async def review_classification(drug_id: str, body: ReviewIn, request: Request, user: CurrentUser = Depends(require_admin)):
    db = user.db()
    areas = sorted(set(body.therapeutic_areas) | {body.department}, key=lambda a: (a == OTHER, a))
    await db.insert("drug_classifications", {
        "drug_id": drug_id, "department": body.department, "therapeutic_areas": areas, "confidence": 1,
        "reason": body.reason, "evidence": [], "source": "MANUAL", "review_status": body.action,
        "classified_by": user.id,
    })
    updated = await db.update("fda_drugs", [("id", f"eq.{drug_id}")], {
        "department": body.department, "therapeutic_areas": areas, "therapeutic_area": AREA_LABEL[body.department],
        "classification_status": body.action,
    }, returning="id,department,classification_status")
    if not updated:
        raise HTTPException(404, "Drug not found")
    await audit("FDA classification reviewed", user, "fda_drugs", drug_id, body.model_dump(), request)
    return updated[0]


@router.post("/api/fda/drugs/classify-ai")
async def classify_needs_review(request: Request, limit: int = Query(5, ge=1, le=10), user: CurrentUser = Depends(require_admin)):
    """Second opinion from OpenRouter for NEEDS_REVIEW drugs. Accepted only when it quotes the FDA label."""
    if not get_settings().openrouter_api_key:
        raise HTTPException(503, "OPENROUTER_API_KEY is not configured on the server.")
    db = user.db()
    rows, _ = await db.select("fda_drugs", [("select", "id,indication,classification_status"),
                                            ("classification_status", "eq.NEEDS_REVIEW"), ("indication", "not.is.null"),
                                            ("order", "updated_at.asc"), ("limit", str(limit))])
    results = []
    for d in rows:
        try:
            answer, model, usage, raw = await ai.classify_with_ai(d["indication"])
        except Exception as exc:
            results.append({"id": d["id"], "status": "FAILED", "error": str(exc)[:200]})
            continue
        c = verify_ai_classification(d["indication"], answer or {})
        await db.insert("ai_runs", {"user_id": user.id, "purpose": "CLASSIFICATION", "drug_id": d["id"], "model": model,
                                    "prompt_version": ai.CLASSIFY_PROMPT_VERSION, "input_data_reference": {"drug_id": d["id"]},
                                    "generated_text": raw, "status": "OK" if c.review_status == "AUTO" else "NEEDS_REVIEW",
                                    "usage": usage})
        await db.insert("drug_classifications", {"drug_id": d["id"], **{k: v for k, v in c.as_dict().items()
                                                                        if k not in ("therapeutic_area",)},
                                                 "model": model, "classified_by": user.id})
        if c.review_status == "AUTO":
            await db.update("fda_drugs", [("id", f"eq.{d['id']}"), ("classification_status", "eq.NEEDS_REVIEW")], {
                "department": c.department, "therapeutic_areas": c.therapeutic_areas,
                "therapeutic_area": c.therapeutic_area, "classification_status": "CLASSIFIED"})
        results.append({"id": d["id"], "status": c.review_status, "department": c.department, "reason": c.reason})
    await audit("FDA AI classification", user, "fda_drugs", None, {"count": len(results)}, request)
    return {"items": results}


@router.post("/api/fda/drugs/{drug_id}/kegg")
async def fetch_kegg(drug_id: str, request: Request, user: CurrentUser = Depends(require_admin)):
    db = user.db()
    rows, _ = await db.select("fda_drugs", {"id": f"eq.{drug_id}", "select": "id,generic_name,active_ingredient,drug_name,therapeutic_areas,review_flags"})
    if not rows:
        raise HTTPException(404, "Drug not found")
    d = rows[0]
    try:
        k = await kegg_service.lookup(d.get("generic_name") or d.get("active_ingredient") or d["drug_name"])
    except ProviderNotConfigured as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"KEGG lookup failed: {exc}")
    if not k:
        return {"found": False}
    conflict = kegg_service.conflict_with_fda(k.pop("areas"), d.get("therapeutic_areas") or [])
    await db.insert("kegg_drugs", {"drug_id": drug_id, **k, "conflict": conflict,
                                   "last_updated": datetime.now(timezone.utc).isoformat()},
                    on_conflict="drug_id", resolution="merge-duplicates")
    if conflict:
        flags = list(d.get("review_flags") or [])
        if conflict not in flags:
            await db.update("fda_drugs", [("id", f"eq.{drug_id}")], {"review_flags": flags + [conflict]})
    await audit("KEGG reference fetched", user, "fda_drugs", drug_id, {"kegg_id": k["kegg_id"]}, request)
    return {"found": True, "kegg": k, "conflict": conflict}


# ------------------------------------------------------------------ sync
def _admin_store(db: PostgREST) -> fda_service.SyncStore:
    async def write(drugs, source_date):
        return await db.rpc("fda_sync_write", {"p_token": "", "p_drugs": drugs, "p_source_last_updated": source_date})

    async def save(run):
        return await db.rpc("fda_sync_run_save", {"p_token": "", "p_run": run})

    async def keys(rows):
        return await db.rpc("fda_set_india_keys", {"p_token": "", "p_rows": rows})

    async def match():
        return await db.rpc("fda_match_india", {"p_token": ""})
    return fda_service.SyncStore(write, save, keys, match)


def _token_store(token: str) -> fda_service.SyncStore:
    db = PostgREST()  # anon key; the token is checked inside the database functions

    async def write(drugs, source_date):
        return await db.rpc("fda_sync_write", {"p_token": token, "p_drugs": drugs, "p_source_last_updated": source_date})

    async def save(run):
        return await db.rpc("fda_sync_run_save", {"p_token": token, "p_run": run})

    async def keys(rows):
        return await db.rpc("fda_set_india_keys", {"p_token": token, "p_rows": rows})

    async def match():
        return await db.rpc("fda_match_india", {"p_token": token})
    return fda_service.SyncStore(write, save, keys, match)


class SyncIn(BaseModel):
    mode: Literal["AUTO", "FULL", "INCREMENTAL"] = "AUTO"
    restart: bool = False


async def _continue_sync(store, context: dict, body: SyncIn, trigger: str) -> dict:
    running = context.get("running")
    if running and not body.restart:
        cursor_rows = running
        return await fda_service.run_sync_chunk(store, {"id": running["id"], "cursor": cursor_rows["cursor"]},
                                                trigger=trigger)
    if running and body.restart:
        await store.save_run({"id": running["id"], "status": "FAILED", "finished": True, "errors": ["Restarted by user"]})
    last = context.get("last_success")
    mode = body.mode
    if mode == "AUTO":
        mode = "INCREMENTAL" if last and (context.get("drug_count") or 0) > 0 else "FULL"
    since = fda_service.incremental_since(last) if mode == "INCREMENTAL" else None
    if mode == "INCREMENTAL" and not since:
        mode = "FULL"
    return await fda_service.run_sync_chunk(store, None, mode=mode, trigger=trigger, since=since)


@router.post("/api/fda/sync")
async def sync(body: SyncIn, request: Request, user: CurrentUser = Depends(require_admin)):
    db = user.db()
    context = await db.rpc("fda_sync_context", {"p_token": ""})
    try:
        result = await _continue_sync(_admin_store(db), context, body, "MANUAL")
    except fda_service.FDAError as exc:
        raise HTTPException(502, f"FDA synchronization failed. Please try again. ({exc})")
    if result["done"]:
        await audit("FDA sync", user, "fda_sync_runs", result["run_id"],
                    {k: result[k] for k in ("new", "updated", "unchanged", "failed", "status")}, request)
    return result


@router.api_route("/api/cron/fda-sync", methods=["GET", "POST"])
async def scheduled_sync(
    authorization: str | None = Header(None),
    x_automation_token: str | None = Header(None),
    force: bool = False,
):
    """For the Vercel cron (Authorization: Bearer <token>) or n8n (X-Automation-Token).
    Runs one time-boxed chunk; call again while "done" is false."""
    token = (x_automation_token or "").strip()
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(401, "Automation token required")
    store = _token_store(token)
    try:
        context = await PostgREST().rpc("fda_sync_context", {"p_token": token})
    except SupabaseError as exc:
        raise HTTPException(401 if exc.status in (401, 403) or "Not allowed" in exc.message else 502, exc.message)
    if not context.get("running") and not force and not fda_service.sync_due(context.get("settings"), context.get("last_success")):
        return {"skipped": True, "reason": "Not due by the configured schedule", "schedule": (context.get("settings") or {}).get("schedule")}
    try:
        return await _continue_sync(store, context, SyncIn(), "SCHEDULED")
    except fda_service.FDAError as exc:
        raise HTTPException(502, f"FDA synchronization failed: {exc}")


@router.get("/api/fda/sync/runs")
async def sync_runs(user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("fda_sync_runs", [
        ("select", "id,status,mode,trigger,started_at,finished_at,new_count,updated_count,unchanged_count,failed_count,fetched_count,errors,source_last_updated"),
        ("order", "started_at.desc"), ("limit", "10")])
    return rows


# ------------------------------------------------------------------ India (CDSCO)
@router.post("/api/fda/cdsco/sync")
async def cdsco_sync(request: Request, user: CurrentUser = Depends(require_admin)):
    """Downloads / refreshes the CDSCO approved-new-drug lists (a chunk per call), then
    marks every drug approved / not found / unknown. Call again while 'done' is false."""
    db = user.db()
    try:
        fetched = await cdsco_service.fetch_documents(db)
    except Exception as exc:
        raise HTTPException(502, f"Could not read the CDSCO website: {exc}")
    if fetched["remaining"]:
        return {"done": False, **fetched}
    missing = await db.select_all("fda_drugs", [("select", "application_number,active_ingredient,generic_name"),
                                                ("india_keys", "is.null")])
    if missing:
        await cdsco_service.backfill_keys(lambda fn, rows: db.rpc(fn, {"p_token": "", "p_rows": rows}), missing)
    result = await db.rpc("fda_match_india", {"p_token": ""})
    docs, _ = await db.select("cdsco_documents", {"select": "title,pages,text_pages,error"})
    scanned = [d["title"] for d in docs if d.get("pages") and not d.get("text_pages")]
    failed = [d["title"] for d in docs if d.get("error")]
    await audit("CDSCO check", user, "fda_drugs", None, {"result": result, "documents": len(docs)}, request)
    return {"done": True, **fetched, "result": result, "documents": len(docs), "scanned_without_text": scanned,
            "failed_documents": failed}


@router.get("/api/fda/cdsco/documents")
async def cdsco_documents(user: CurrentUser = Depends(get_current_user)):
    rows, _ = await user.db().select("cdsco_documents", [("select", "id,title,url,pages,text_pages,error,fetched_at"),
                                                          ("order", "id.asc")])
    return rows


class IndiaIn(BaseModel):
    status: Literal["MANUAL_APPROVED", "MANUAL_NOT_APPROVED", "AUTO"]
    reason: str = Field(min_length=3, max_length=500)


@router.post("/api/fda/drugs/{drug_id}/india")
async def set_india(drug_id: str, body: IndiaIn, request: Request, user: CurrentUser = Depends(require_admin)):
    db = user.db()
    if body.status == "AUTO":
        rows = await db.update("fda_drugs", [("id", f"eq.{drug_id}")], {"india_status": None}, returning="id")
        await db.rpc("fda_match_india", {"p_token": ""})
    else:
        rows = await db.update("fda_drugs", [("id", f"eq.{drug_id}")], {
            "india_status": body.status, "india_evidence": f"Set by {user.email}: {body.reason}",
            "india_checked_at": datetime.now(timezone.utc).isoformat()}, returning="id")
    if not rows:
        raise HTTPException(404, "Drug not found")
    await audit("India status set", user, "fda_drugs", drug_id, body.model_dump(), request)
    return {"ok": True}


# ------------------------------------------------------------------ settings
@router.get("/api/fda/settings")
async def get_fda_settings(user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows, _ = await db.select("app_settings", {"key": "eq.fda_settings", "select": "value,updated_at"})
    value = rows[0]["value"] if rows else {}
    tokens = {}
    if user.is_admin:
        t, _ = await db.select("app_settings", [("key", "in.(automation_token,webhook_token)"), ("select", "key,updated_at")])
        tokens = {r["key"]: r["updated_at"] for r in t}
    return {**value, "tokens": tokens}


class SenderIn(BaseModel):
    name: str = Field("", max_length=120)
    phone: str = Field("", max_length=40)
    email: str = Field("", max_length=160)


class SettingsIn(BaseModel):
    schedule: Literal["daily", "weekly", "manual"]
    sender: SenderIn


@router.put("/api/fda/settings")
async def put_fda_settings(body: SettingsIn, request: Request, user: CurrentUser = Depends(require_admin)):
    value = body.model_dump()
    await user.db().insert("app_settings", {"key": "fda_settings", "value": value, "updated_by": user.id,
                                            "updated_at": datetime.now(timezone.utc).isoformat()},
                           on_conflict="key", resolution="merge-duplicates")
    await audit("FDA settings changed", user, "app_settings", "fda_settings", value, request)
    return value


class TokenIn(BaseModel):
    kind: Literal["automation", "webhook"]


@router.post("/api/fda/settings/token")
async def new_token(body: TokenIn, request: Request, user: CurrentUser = Depends(require_admin)):
    """Creates a new secret (shown once). Only its SHA-256 hash is stored."""
    token = secrets.token_urlsafe(32)
    await user.db().insert("app_settings", {
        "key": f"{body.kind}_token", "value": {"hash": hashlib.sha256(token.encode()).hexdigest()},
        "updated_by": user.id, "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key", resolution="merge-duplicates")
    await audit("Automation token created", user, "app_settings", f"{body.kind}_token", None, request)
    base = get_settings().app_url or ""
    out = {"kind": body.kind, "token": token}
    if body.kind == "webhook":
        out["webhook_url"] = f"{base}/api/webhooks/cunnekt?token={token}"
    else:
        out["endpoint"] = f"{base}/api/cron/fda-sync"
    return out


# ------------------------------------------------------------------ doctors
FDA_DOCTOR_COLUMNS = (
    "id,doctor_name,specialty,qualification,department,sub_department,institute,city,state,email,contact_number,"
    "whatsapp_number,must_see,contact_frequency,frequency_days,last_message_sent_at,next_eligible_at,created_at,origin"
)


@router.get("/api/fda/doctors")
async def fda_doctors(
    q: str | None = None,
    audience: Literal["all", "must_see", "regular", "new"] = "all",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    from .doctors import search_terms
    p: list[tuple[str, str]] = [("select", FDA_DOCTOR_COLUMNS), ("department", f"in.({','.join(user.departments)})"),
                                ("order", "must_see.desc,doctor_name.asc")]
    terms = search_terms(q)
    if terms:
        p.append(("and", "(" + ",".join(f'search_text.ilike."*{t}*"' for t in terms) + ")"))
    if audience == "must_see":
        p.append(("must_see", "is.true"))
    elif audience == "regular":
        p.append(("must_see", "is.false"))
    elif audience == "new":
        since = datetime.now(timezone.utc).timestamp() - 30 * 86400
        p.append(("created_at", f"gte.{datetime.fromtimestamp(since, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"))
    rows, total = await user.db().select("doctors", p, count=True, offset=(page - 1) * page_size, limit=page_size)
    for d in rows:
        areas = doctor_areas(d)
        ok, until = eligibility(d)
        d.update({"areas": areas, "areas_label": areas_label(areas), "eligible": ok, "eligible_from": until})
    return {"items": rows, "total": total or 0, "page": page, "page_size": page_size}


@router.get("/api/fda/doctors/{doctor_id}/recommendations")
async def doctor_recommendations(doctor_id: str, q: str | None = None, user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows, _ = await db.select("doctors", {"id": f"eq.{doctor_id}", "select": FDA_DOCTOR_COLUMNS})
    if not rows:
        raise HTTPException(404, "Doctor not found")
    doctor = rows[0]
    ok, until = eligibility(doctor)
    rec = await recommend(db, doctor, limit=15, q=q)
    return {"doctor": {**doctor, "eligible": ok, "eligible_from": until}, **rec}


class OutreachIn(BaseModel):
    must_see: bool | None = None
    contact_frequency: Literal["WEEKLY", "15_DAYS", "MONTHLY", "CUSTOM"] | None = None
    frequency_days: int | None = Field(None, ge=1, le=365)


@router.put("/api/fda/doctors/{doctor_id}/outreach")
async def set_outreach(doctor_id: str, body: OutreachIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    try:
        await user.db().rpc("set_doctor_outreach", {"p_doctor": doctor_id, "p_must_see": body.must_see,
                                                    "p_frequency": body.contact_frequency, "p_days": body.frequency_days})
    except SupabaseError as exc:
        raise HTTPException(404 if "not found" in exc.message.lower() else 400, exc.message)
    await audit("Doctor outreach settings", user, "doctors", doctor_id, body.model_dump(), request)
    return {"ok": True}


# ------------------------------------------------------------------ bulk upload
@router.post("/api/fda/bulk/parse")
async def bulk_parse(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    data = await file.read(bulk_import.MAX_BYTES + 1)
    try:
        header, rows = bulk_import.read_table(file.filename or "", data)
    except bulk_import.UploadError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "Could not read this file. Check that it is a valid Excel or CSV file.")
    return {"filename": file.filename, "columns": header, "rows": rows, "mapping": bulk_import.auto_mapping(header),
            "fields": bulk_import.FIELD_NAMES}


class ValidateIn(BaseModel):
    rows: list[list[str]] = Field(max_length=bulk_import.MAX_ROWS)
    mapping: dict[str, int | None]
    default_department: Literal["NPP", "RARE_DISEASES"] | None = None


@router.post("/api/fda/bulk/validate")
async def bulk_validate(body: ValidateIn, user: CurrentUser = Depends(get_current_user)):
    if body.mapping.get("doctor_name") is None:
        raise HTTPException(400, "Map the Doctor Name column first.")
    existing = await user.db().select_all("doctors", [
        ("select", "id,department,sub_department,doctor_name,institute,email_norm,phone_norm,name_norm"),
        ("department", f"in.({','.join(user.departments)})")])
    default = body.default_department if body.default_department in user.departments else (
        user.role if not user.is_admin else None)
    return bulk_import.validate(body.rows, body.mapping, existing, user.departments, default)


class ImportRow(BaseModel):
    doctor_id: str | None = Field(None, max_length=40)  # existing doctor: only Must See / frequency are applied
    department: Literal["NPP", "RARE_DISEASES"] | None = None
    dedupe_key: str | None = Field(None, min_length=3, max_length=300)
    doctor_name: str | None = Field(None, min_length=1, max_length=200)
    sub_department: str | None = Field(None, max_length=80)
    specialty: str | None = Field(None, max_length=200)
    institute: str | None = Field(None, max_length=300)
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=100)
    country: str | None = Field(None, max_length=100)
    whatsapp_number: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=200)
    email_norm: str | None = Field(None, max_length=200)
    phone_norm: str | None = Field(None, max_length=20)
    name_norm: str | None = Field(None, max_length=200)
    must_see: bool | None = None
    contact_frequency: Literal["WEEKLY", "15_DAYS", "MONTHLY", "CUSTOM"] | None = None
    frequency_days: int | None = Field(None, ge=1, le=365)
    notes: str | None = Field(None, max_length=1000)
    active: str | None = Field(None, max_length=20)


    @model_validator(mode="after")
    def new_rows_need_identity(self):
        if not self.doctor_id and not (self.department and self.dedupe_key and self.doctor_name):
            raise ValueError("New doctors need department, dedupe_key and doctor_name")
        return self


class ImportIn(BaseModel):
    rows: list[ImportRow] = Field(min_length=1, max_length=bulk_import.MAX_ROWS)


@router.post("/api/doctors/import")
async def import_doctors(body: ImportIn, request: Request, user: CurrentUser = Depends(get_current_user)):
    """Adds confirmed new doctors (and applies Must See / frequency to existing ones). Never duplicates."""
    out = []
    payload = []
    for r in body.rows:
        row = r.model_dump(exclude_none=True)
        if r.doctor_id:  # existing doctor: nothing but the outreach fields
            row = {k: v for k, v in row.items() if k in ("doctor_id", "must_see", "contact_frequency", "frequency_days")}
        payload.append(row)
    for i in range(0, len(payload), 200):
        try:
            res = await user.db().rpc("fda_add_doctors", {"p_rows": payload[i:i + 200]})
        except SupabaseError as exc:
            raise HTTPException(403 if "cannot add" in exc.message else 400, exc.message)
        out.extend({"idx": r["idx"] + i, "doctor_id": r["doctor_id"], "created": r["created"]} for r in res)
    created = sum(1 for r in out if r["created"])
    await audit("Doctors imported", user, "doctors", None, {"created": created, "matched": len(out) - created}, request)
    return {"items": out, "created": created, "matched": len(out) - created}


_ = (Any, AREAS, DRUG_COLUMNS)
