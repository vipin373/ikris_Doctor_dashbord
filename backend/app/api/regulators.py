"""EMA and PMDA drug imports into the shared drug-communication pipeline.

After import, the rows are classified (same classifier as FDA), checked against the
CDSCO lists of drugs approved in India, and then appear in the EMA / PMDA workspaces
with the same doctor matching, templates, campaigns and sending as FDA.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from ..core.security import CurrentUser, require_admin
from ..core.supabase import PostgREST
from ..services import cdsco_service, reg_sources
from ..services.audit import audit
from ..services.regulators import INFO

router = APIRouter(prefix="/api/reg", tags=["regulators"])
WRITE_BATCH = 150
PMDA_PAGES_PER_CALL = 30
MAX_UPLOAD = 20 * 1024 * 1024


async def _write(db: PostgREST, rows: list[dict]) -> dict[str, int]:
    totals = {"new": 0, "updated": 0, "unchanged": 0}
    sem = asyncio.Semaphore(3)

    async def one(batch):
        async with sem:
            return await db.rpc("fda_sync_write", {"p_token": "", "p_drugs": batch, "p_source_last_updated": None})

    for res in await asyncio.gather(*(one(rows[i:i + WRITE_BATCH]) for i in range(0, len(rows), WRITE_BATCH))):
        for k in totals:
            totals[k] += int(res.get(k) or 0)
    return totals


async def _india_check(db: PostgREST, regulator: str) -> Any:
    """Ingredient keys for this regulator's drugs, then the CDSCO match (same rules as FDA)."""
    drugs = await db.select_all("fda_drugs", [("select", "application_number,active_ingredient,generic_name"),
                                              ("regulator", f"eq.{regulator}")])
    if drugs:
        await cdsco_service.backfill_keys(lambda fn, rows: db.rpc(fn, {"p_token": "", "p_rows": rows}), drugs)
    return await db.rpc("fda_match_india", {"p_token": ""})


async def _run_start(db: PostgREST, regulator: str) -> str:
    return await db.rpc("fda_sync_run_save", {"p_token": "", "p_run": {"mode": "FULL", "trigger": "MANUAL", "regulator": regulator}})


async def _run_update(db: PostgREST, run_id: str, **fields) -> None:
    await db.rpc("fda_sync_run_save", {"p_token": "", "p_run": {"id": run_id, **fields}})


# ------------------------------------------------------------------ EMA
async def _ema(request: Request, user: CurrentUser, content: bytes | None) -> dict:
    db = user.db()
    run_id = await _run_start(db, "EMA")
    try:
        if content is None:
            async with httpx.AsyncClient(timeout=httpx.Timeout(40, connect=10), follow_redirects=True,
                                         headers={"User-Agent": "IKRIS-Doctor-Connect/1.0"}) as c:
                r = await c.get(reg_sources.EMA_FILE_URL)
            if r.status_code == 429:
                raise HTTPException(502, "EMA asked us to slow down. Try again in an hour, or download the 'Medicines' "
                                         "Excel file from the EMA website and upload it here.")
            r.raise_for_status()
            content = r.content
        rows, skipped = reg_sources.ema_rows(content)
        counts = await _write(db, rows)
        india = await _india_check(db, "EMA")
    except HTTPException as exc:
        await _run_update(db, run_id, status="FAILED", finished=True, errors=[exc.detail])
        raise
    except Exception as exc:  # noqa: BLE001 - shown to the admin and kept on the run
        await _run_update(db, run_id, status="FAILED", finished=True, errors=[str(exc)[:300]])
        raise HTTPException(502, f"EMA import failed: {exc}") from exc
    await _run_update(db, run_id, status="PARTIAL" if skipped else "SUCCESS", finished=True, fetched=len(rows),
                      errors=[f"{s['name']}: {s['error']}" for s in skipped[:50]], **counts)
    await audit("EMA drug import", user, "fda_sync_runs", run_id, {**counts, "india": india}, request)
    return {"run_id": run_id, "done": True, "fetched": len(rows), **counts, "skipped": len(skipped), "india": india,
            "credit": INFO["EMA"]["source_terms"]}


@router.post("/ema/sync")
async def ema_sync(request: Request, user: CurrentUser = Depends(require_admin)):
    return await _ema(request, user, None)


@router.post("/ema/upload")
async def ema_upload(request: Request, file: UploadFile = File(...), user: CurrentUser = Depends(require_admin)):
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File too large")
    return await _ema(request, user, content)


# ------------------------------------------------------------------ PMDA (admin uploads the PDF; no automated download)
@router.post("/pmda/upload")
async def pmda_upload(
    request: Request,
    file: UploadFile = File(...),
    start: int = Form(2, ge=0),
    run_id: str | None = Form(None),
    user: CurrentUser = Depends(require_admin),
):
    """Reads PMDA_PAGES_PER_CALL pages per call. Call again with `start = next` and the same run_id until done."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Upload the PMDA 'List of Approved Products' PDF.")
    db = user.db()
    try:
        pages = reg_sources.pmda_page_count(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the PDF: {exc}") from exc
    if not run_id:
        run_id = await _run_start(db, "PMDA")
    end = min(pages, max(start, 2) + PMDA_PAGES_PER_CALL)
    try:
        rows, problems = await asyncio.to_thread(reg_sources.pmda_rows, data, max(start, 2), end)
    except Exception as exc:  # noqa: BLE001
        await _run_update(db, run_id, status="FAILED", finished=True, errors=[f"Pages {start + 1}-{end}: {exc}"[:300]])
        raise HTTPException(400, f"This does not look like the PMDA approved products list ({exc}).") from exc
    if start <= 2 and end >= pages and not rows:
        await _run_update(db, run_id, status="FAILED", finished=True, errors=["No approval rows found in the PDF"])
        raise HTTPException(400, "No approval rows were found. Upload the PMDA 'List of Approved Products' PDF.")
    counts = await _write(db, rows) if rows else {"new": 0, "updated": 0, "unchanged": 0}
    done = end >= pages
    fields: dict[str, Any] = {**counts, "fetched": len(rows)}
    if problems:
        fields["errors"] = [f"{p['name'][:80]}: {p['error']}" for p in problems[:50]]
    india = None
    if done:
        india = await _india_check(db, "PMDA")
        await _run_update(db, run_id, **fields)
        runs, _ = await db.select("fda_sync_runs", {"id": f"eq.{run_id}", "select": "errors,new_count,updated_count,unchanged_count,fetched_count"})
        has_errors = bool(runs and runs[0].get("errors"))
        await _run_update(db, run_id, status="PARTIAL" if has_errors else "SUCCESS", finished=True)
        await audit("PMDA drug import", user, "fda_sync_runs", run_id, {"pages": pages, "india": india, **(runs[0] if runs else {})}, request)
    else:
        await _run_update(db, run_id, **fields)
    return {"run_id": run_id, "done": done, "next": end, "pages": pages, **counts, "rows": len(rows),
            "problems": len(problems), "india": india, "credit": INFO["PMDA"]["source_terms"]}
