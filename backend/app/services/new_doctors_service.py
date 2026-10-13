"""New Doctors: Apollo-found leads from the "IKRIS Doctor Mailer" sheet.

Kept completely separate from the main doctor directory: rows go only into
public.new_doctors and are never merged into public.doctors, dashboard
counts, reminders, campaigns or FDA doctor matching.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from ..core.supabase import PostgREST
from .google_sheets_service import _read_public_csv
from .mapping import IST

SHEET_ID = os.getenv("NEW_DOCTORS_SHEET_ID", "1hUtB8yI_UgsLmREPCtehpXrJvirxRp_4J_lRxGv5qhg")
SHEET_GID = int(os.getenv("NEW_DOCTORS_SHEET_GID", "0"))
TABLE = "new_doctors"

HEADERS = {
    "doctor_name": ("doctor name", "name", "doctor"),
    "specialty": ("specialty", "speciality"),
    "hospital": ("hospital", "institute", "hospital name"),
    "city": ("city", "location"),
    "email": ("email", "email id", "e-mail"),
    "status": ("status", "mail status"),
    "sent_date_raw": ("sent date", "sent on", "date sent"),
    "subject_used": ("subject used", "subject"),
    "error": ("error",),
    "follow_up": ("follow-up", "follow up", "followup"),
    "thread_id": ("thread id", "thread"),
    "sub_department": ("department",),
}
FIELDS = list(HEADERS)


def _norm(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower())


def _clean(v: Any) -> str | None:
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    return v or None


def parse_sent_date(raw: str | None) -> str | None:
    """'13/08/2026 11:14:57' (DD/MM/YYYY, IST) -> UTC ISO. Unknown formats -> None."""
    if not raw:
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw.strip(), fmt).replace(tzinfo=IST)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    return None


def map_rows(values: list[list[str]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Sheet values -> table rows. Returns (rows, warnings)."""
    if not values:
        return [], ["The sheet is empty."]
    header = [_norm(h) for h in values[0]]
    col: dict[str, int] = {}
    for field, names in HEADERS.items():
        for i, h in enumerate(header):
            if h in names:
                col[field] = i
                break
    warnings: list[str] = []
    if "doctor_name" not in col:
        return [], ["No 'Doctor Name' column found in the sheet."]
    known = set(col.values())
    extra_cols = [(i, values[0][i].strip()) for i in range(len(header)) if i not in known and header[i]]

    rows: list[dict[str, Any]] = []
    seen: Counter[str] = Counter()
    for n, raw in enumerate(values[1:], start=2):
        def cell(field: str) -> str | None:
            i = col.get(field)
            return _clean(raw[i]) if i is not None and i < len(raw) else None

        name = cell("doctor_name")
        if not name:
            continue
        rec: dict[str, Any] = {f: cell(f) for f in FIELDS}
        rec["doctor_name"] = name
        if rec["email"]:
            rec["email"] = rec["email"].lower()
        identity = (rec["email"] or f"{name}|{rec['hospital'] or ''}").lower()
        seen[identity] += 1
        rec["row_key"] = hashlib.sha256(f"{identity}#{seen[identity]}".encode()).hexdigest()[:32]
        rec["sheet_row"] = n
        rec["department"] = "NPP"
        rec["sent_at"] = parse_sent_date(rec["sent_date_raw"])
        if rec["sent_date_raw"] and not rec["sent_at"]:
            warnings.append(f"Row {n}: could not read Sent Date '{rec['sent_date_raw']}'.")
        rec["extra"] = {label: _clean(raw[i]) for i, label in extra_cols if i < len(raw) and _clean(raw[i])}
        rows.append(rec)
    return rows, warnings


async def sync(db: PostgREST) -> dict[str, Any]:
    values = await _read_public_csv(SHEET_ID, SHEET_GID)
    rows, warnings = map_rows(values)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for r in rows:
        r["synced_at"] = now

    existing = await db.select_all(TABLE, [("select", "row_key")])
    old_keys = {r["row_key"] for r in existing}
    new_keys = {r["row_key"] for r in rows}

    for i in range(0, len(rows), 500):
        await db.insert(TABLE, rows[i:i + 500], on_conflict="row_key", resolution="merge-duplicates")
    removed = sorted(old_keys - new_keys)
    for i in range(0, len(removed), 100):
        await db.delete(TABLE, [("row_key", f"in.({','.join(removed[i:i + 100])})")])

    return {
        "rows": len(rows),
        "added": len(new_keys - old_keys),
        "updated": len(new_keys & old_keys),
        "removed": len(removed),
        "warnings": warnings[:20],
        "synced_at": now,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def count(field: str) -> list[dict[str, Any]]:
        c = Counter((r.get(field) or "Not set") for r in rows)
        return [{"name": k, "count": v} for k, v in c.most_common()]

    synced = max((r["synced_at"] for r in rows if r.get("synced_at")), default=None)
    return {
        "total": len(rows),
        "with_email": sum(1 for r in rows if r.get("email")),
        "sent": sum(1 for r in rows if (r.get("status") or "").lower() == "sent"),
        "errors": sum(1 for r in rows if r.get("error")),
        "follow_up_pending": sum(1 for r in rows if (r.get("follow_up") or "").lower() == "pending"),
        "by_specialty": count("specialty"),
        "by_status": count("status"),
        "by_follow_up": count("follow_up"),
        "by_department": count("sub_department"),
        "by_city": count("city"),
        "last_synced_at": synced,
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit#gid={SHEET_GID}",
    }
