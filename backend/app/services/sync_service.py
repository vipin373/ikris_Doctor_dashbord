"""Google Sheets -> Supabase synchronisation.

Safe by design:
- adds new records, updates changed ones (hash comparison), leaves unchanged
  ones alone;
- never deletes: rows that disappear from a sheet are flagged
  ``missing_from_source`` for an Admin to review;
- never writes back to Google Sheets.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core.config import get_settings
from ..core.security import CurrentUser
from ..core.supabase import PostgREST, ServiceUnavailable, SupabaseError
from .google_sheets_service import SheetReadError, discover_tabs, read_tab
from .mapping import (
    DOCTOR_FIELDS, TabContext, TabResult, build_headers, detect_kind, map_doctor_tab, map_feedback_tab,
    merge_doctors,
)

FEEDBACK_FIELDS = [
    "department", "division", "patient_id", "patient_name", "country_code", "phone_number", "medicine",
    "doctor_name", "hospital", "disease", "feedback", "rating", "request_date", "sent_date",
    "whatsapp_status", "review_link", "status",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _unique(rows: list[dict[str, Any]], *keys: str) -> tuple[list[dict[str, Any]], int]:
    seen: set[tuple] = set()
    out = []
    for row in rows:
        k = tuple(row[key] for key in keys)
        if k in seen:
            continue
        seen.add(k)
        out.append(row)
    return out, len(rows) - len(out)


async def _discover(db: PostgREST, sources: list[dict], tabs: list[dict], steps: list[str]) -> list[dict]:
    """Add tabs that exist in Google Sheets but not yet in the database."""
    if not get_settings().has_google_service_account:
        steps.append("Tab discovery skipped: no Google service account configured (public-link mode).")
        return []
    known = {(t["source_id"], t["tab_name"]) for t in tabs}
    discovered = []
    for src in sources:
        try:
            props = await discover_tabs(src["spreadsheet_id"])
        except SheetReadError as exc:
            steps.append(f"Could not list tabs of '{src['name']}': {exc}")
            continue
        for prop in props:
            if (src["id"], prop["title"]) in known:
                continue
            try:
                values = await read_tab(src["spreadsheet_id"], prop["title"], prop.get("sheetId"), None)
                headers = build_headers(values[0], len(values[0])) if values else []
                kind = detect_kind(headers)
            except SheetReadError:
                headers, kind = [], "ignore"
            row = {
                "source_id": src["id"], "tab_name": prop["title"], "sheet_gid": prop.get("sheetId"),
                "data_kind": kind, "is_enabled": kind != "ignore" and bool(src.get("default_department")),
                "department_code": src.get("default_department"),
                "sub_department": prop["title"] if kind == "doctors" else None,
                "headers": headers, "mapping": {},
            }
            inserted = await db.insert("google_sheet_tabs", row, returning="*")
            discovered.extend(inserted)
            steps.append(f"New tab discovered: {src['name']} / {prop['title']} ({kind}).")
    return discovered


def _sync_db(user: CurrentUser | None) -> PostgREST:
    """Service role when configured; otherwise the Admin's own session
    (RLS allows Admins to write the sync tables)."""
    if get_settings().has_service_role:
        return PostgREST.service()
    if user and user.is_admin:
        return user.db()
    raise ServiceUnavailable("Scheduled sync needs SUPABASE_SERVICE_ROLE_KEY on the server. Use 'Sync now' instead.")


async def run_sync(user: CurrentUser | None, trigger_type: str = "manual") -> dict[str, Any]:
    db = _sync_db(user)
    started = _now()
    steps: list[str] = ["Reading Google Sheet connections..."]
    log_rows = await db.insert("google_sheet_sync_logs", {
        "triggered_by": user.id if user else None, "trigger_type": trigger_type, "status": "running",
    }, returning="id")
    log_id = log_rows[0]["id"]

    try:
        sources = await db.select_all("google_sheet_sources", [("select", "*"), ("is_active", "eq.true")])
        tabs = await db.select_all("google_sheet_tabs", [("select", "*"), ("order", "id")])
        steps.append("Reading tabs...")
        tabs += await _discover(db, sources, tabs, steps)
        source_by_id = {s["id"]: s for s in sources}

        doctor_results: list[tuple[TabContext, TabResult]] = []
        feedback_results: list[tuple[TabContext, TabResult]] = []
        reports: list[dict[str, Any]] = []
        for tab in tabs:
            src = source_by_id.get(tab["source_id"])
            if not src or not tab["is_enabled"] or tab["data_kind"] == "ignore":
                continue
            mapping = tab.get("mapping") or {}
            report = {"tab_id": tab["id"], "source": src["name"], "tab": tab["tab_name"], "status": "Synced",
                      "rows": 0, "errors": [], "headers": tab.get("headers") or []}
            try:
                values = await read_tab(src["spreadsheet_id"], tab["tab_name"], tab.get("sheet_gid"),
                                        mapping.get("access_mode"))
                ctx = TabContext(
                    spreadsheet_id=src["spreadsheet_id"], sheet_name=tab["tab_name"],
                    department=tab.get("department_code") or src.get("default_department"),
                    sub_department=tab.get("sub_department"), specialty=tab.get("specialty"),
                    mapping=mapping, header_row=int(mapping.get("header_row", 1)),
                )
                if tab["data_kind"] == "doctors":
                    res = map_doctor_tab(ctx, values)
                    doctor_results.append((ctx, res))
                    report["rows"] = len(res.doctors)
                else:
                    res = map_feedback_tab(ctx, values)
                    feedback_results.append((ctx, res))
                    report["rows"] = len(res.feedback)
                report["headers"] = res.headers
                report["errors"] = res.errors[:50]
                report["ctx"] = ctx
            except SheetReadError as exc:
                report.update(status="Failed", error=str(exc))
            reports.append(report)

        steps.append("Processing records...")
        merged, duplicate_rows = merge_doctors(doctor_results)

        steps.append("Checking duplicates...")
        existing = await db.select_all("doctors", [("select", "id,department,dedupe_key,source_record_hash")])
        ids = {(d["department"], d["dedupe_key"]): d["id"] for d in existing}
        hashes = {(d["department"], d["dedupe_key"]): d["source_record_hash"] for d in existing}
        now = _now()
        new_docs, changed_docs = [], []
        for doc in merged:
            key = (doc.department, doc.dedupe_key)
            if key not in ids:
                new_docs.append(doc)
            elif hashes.get(key) != doc.record_hash:
                changed_docs.append(doc)

        steps.append("Updating doctors...")
        steps.append("Adding new doctors...")
        for batch in _chunks(new_docs + changed_docs, 200):
            payload = []
            for doc in batch:
                ctx0, row0 = doc.rows[0]
                payload.append({
                    **{f: doc.fields.get(f) for f in DOCTOR_FIELDS},
                    "sub_department": doc.fields.get("sub_department"),
                    "email_norm": doc.fields.get("email_norm"),
                    "phone_norm": doc.fields.get("phone_norm"),
                    "name_norm": doc.fields.get("name_norm"),
                    "city_norm": doc.fields.get("city_norm"),
                    "extra": doc.fields.get("extra") or {},
                    "data_issues": doc.issues,
                    "department": doc.department,
                    "dedupe_key": doc.dedupe_key,
                    "source_spreadsheet_id": ctx0.spreadsheet_id,
                    "source_sheet_name": ctx0.sheet_name,
                    "source_row_number": row0.row_number,
                    "source_record_hash": doc.record_hash,
                    "last_synced_at": now,
                })
            written = await db.insert("doctors", payload, on_conflict="department,dedupe_key",
                                      resolution="merge-duplicates", returning="id,department,dedupe_key")
            for w in written:
                ids[(w["department"], w["dedupe_key"])] = w["id"]

        # Source rows (original values, traceability) and outreach events
        source_rows, events = [], []
        tab_id_by_sheet = {(r["ctx"].spreadsheet_id, r["ctx"].sheet_name): r["tab_id"] for r in reports if "ctx" in r}
        for doc in merged:
            doctor_id = ids[(doc.department, doc.dedupe_key)]
            for ctx, row in doc.rows:
                source_rows.append({
                    "doctor_id": doctor_id, "tab_id": tab_id_by_sheet.get((ctx.spreadsheet_id, ctx.sheet_name)),
                    "spreadsheet_id": ctx.spreadsheet_id, "sheet_name": ctx.sheet_name,
                    "row_number": row.row_number, "row_key": row.row_key, "raw_data": row.raw,
                    "record_hash": row.row_hash, "missing_from_source": False, "last_synced_at": now,
                })
                for ev in row.events:
                    events.append({"doctor_id": doctor_id, "department": doc.department, "source": "google_sheet", **ev})
        source_rows, _ = _unique(source_rows, "spreadsheet_id", "sheet_name", "row_key")
        for batch in _chunks(source_rows, 300):
            await db.insert("doctor_source_rows", batch, on_conflict="spreadsheet_id,sheet_name,row_key",
                            resolution="merge-duplicates")
        events, _ = _unique(events, "external_key")
        new_events = 0
        for batch in _chunks(events, 300):
            inserted = await db.insert("communication_events", batch, on_conflict="external_key",
                                       resolution="ignore-duplicates", returning="id")
            new_events += len(inserted)

        # Flag rows that no longer exist in the sheet (never delete)
        flagged = 0
        for rep in reports:
            if rep["status"] != "Synced" or "ctx" not in rep:
                continue
            if any(rep["ctx"] is c for c, _ in doctor_results):
                gone = await db.update("doctor_source_rows", [
                    ("spreadsheet_id", f"eq.{rep['ctx'].spreadsheet_id}"),
                    ("sheet_name", f"eq.{rep['ctx'].sheet_name}"),
                    ("last_synced_at", f"lt.{started}"),
                    ("missing_from_source", "eq.false"),
                ], {"missing_from_source": True}, returning="id")
                flagged += len(gone)

        # Patient feedback
        fb_new = fb_updated = fb_dupes = 0
        if feedback_results:
            existing_fb = await db.select_all("patient_feedback", [("select", "source_key,source_record_hash")])
            fb_hash = {r["source_key"]: r["source_record_hash"] for r in existing_fb}
            fb_rows = []
            for ctx, res in feedback_results:
                for row in res.feedback:
                    if row.source_key in fb_hash and fb_hash[row.source_key] == row.row_hash:
                        continue
                    if row.source_key in fb_hash:
                        fb_updated += 1
                    else:
                        fb_new += 1
                    fb_rows.append({
                        **{f: row.fields.get(f) for f in FEEDBACK_FIELDS},
                        "data_issues": row.issues, "raw_data": row.raw,
                        "source_spreadsheet_id": ctx.spreadsheet_id, "source_sheet_name": ctx.sheet_name,
                        "source_row_number": row.row_number, "source_key": row.source_key,
                        "source_record_hash": row.row_hash, "last_synced_at": now,
                    })
            fb_rows, fb_dupes = _unique(fb_rows, "source_key")
            fb_new -= fb_dupes
            for batch in _chunks(fb_rows, 300):
                await db.insert("patient_feedback", batch, on_conflict="source_key", resolution="merge-duplicates")

        for rep in reports:
            await db.update("google_sheet_tabs", [("id", f"eq.{rep['tab_id']}")], {
                "headers": rep["headers"], "record_count": rep["rows"], "last_synced_at": now,
                "last_status": rep["status"], "last_error": rep.get("error"),
            })

        failed = [r for r in reports if r["status"] == "Failed"]
        status = "failed" if reports and len(failed) == len(reports) else ("partial" if failed else "success")
        row_errors = sum(len(r["errors"]) for r in reports)
        steps.append("Sync completed." if status != "failed" else "Sync failed.")
        summary = {
            "status": status,
            "new": len(new_docs) + fb_new,
            "updated": len(changed_docs) + fb_updated,
            "unchanged": len(merged) - len(new_docs) - len(changed_docs),
            "duplicates": duplicate_rows + fb_dupes,
            "flagged_missing": flagged,
            "errors": len(failed) + row_errors,
            "new_events": new_events,
            "doctors": {"new": len(new_docs), "updated": len(changed_docs), "total_in_sheets": len(merged)},
            "feedback": {"new": fb_new, "updated": fb_updated},
            "tabs": [{k: v for k, v in r.items() if k not in ("ctx", "headers")} for r in reports],
            "steps": steps,
        }
        await db.update("google_sheet_sync_logs", [("id", f"eq.{log_id}")], {
            "finished_at": _now(), "status": status, "new_count": summary["new"],
            "updated_count": summary["updated"], "unchanged_count": summary["unchanged"],
            "duplicate_count": summary["duplicates"], "flagged_missing_count": flagged,
            "error_count": summary["errors"], "details": summary,
        })
        return {"log_id": log_id, **summary}
    except (SupabaseError, SheetReadError, KeyError, ValueError) as exc:
        await db.update("google_sheet_sync_logs", [("id", f"eq.{log_id}")], {
            "finished_at": _now(), "status": "failed", "error_count": 1,
            "details": {"error": str(exc), "steps": steps},
        })
        raise
