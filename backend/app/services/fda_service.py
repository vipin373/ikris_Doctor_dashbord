"""openFDA integration: retrieve, normalise and store FDA drug information.

Sources (both official FDA, via openFDA):
- Drug labels (SPL)   https://api.fda.gov/drug/label.json     indications, pharmacologic class
- Drugs@FDA           https://api.fda.gov/drug/drugsfda.json  applicant, products, approvals, marketing status

Scope: prescription NDA/BLA products whose FDA label indication mentions an
oncology, hematology or rare-disease condition (the areas Ikris serves).
A run is resumable: each call processes pages until a time budget is used and
stores a cursor, so it fits serverless time limits and can be continued by
the dashboard, the Vercel cron or n8n.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import quote

import httpx

from ..core.config import get_settings
from .drug_classifier import TERMS, classify

log = logging.getLogger("fda")

LABEL_PAGE = 50
APPLICATIONS_PER_QUERY = 40
SOURCE_NAME = "openFDA: Drugs@FDA and FDA drug labels (SPL)"


class FDAError(Exception):
    pass


def _search_terms() -> list[str]:
    """Label search terms (strong terms only), de-duplicated across areas."""
    seen: list[str] = []
    for terms in TERMS.values():
        for term, strong in terms:
            if strong and term not in seen:
                seen.append(term)
    return seen


def build_streams(since: date | None = None) -> list[dict[str, Any]]:
    """openFDA label searches covering every area term, in chunks of 10 terms."""
    terms = _search_terms()
    base = 'openfda.product_type:"HUMAN PRESCRIPTION DRUG" AND openfda.application_number:(NDA* OR BLA*)'
    if since:
        base += f" AND effective_time:[{since.strftime('%Y%m%d')} TO 99991231]"
    streams = []
    for i in range(0, len(terms), 10):
        chunk = terms[i:i + 10]
        ors = " OR ".join(f'"{t}"' if (" " in t or "-" in t or "'" in t) else t for t in chunk)
        streams.append({"q": f"{base} AND indications_and_usage:({ors})", "skip": 0, "total": None})
    return streams


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0))


async def fda_get(client: httpx.AsyncClient, endpoint: str, search: str, limit: int, skip: int = 0) -> dict:
    s = get_settings()
    params: dict[str, Any] = {"search": search, "limit": limit}
    if skip:
        params["skip"] = skip
    if s.fda_api_key:
        params["api_key"] = s.fda_api_key
    url = f"{s.fda_api_base_url}/drug/{endpoint}.json"
    for attempt in range(3):
        try:
            resp = await client.get(url, params=params)
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise FDAError(f"FDA API unreachable: {exc}") from exc
            continue
        if resp.status_code == 404:
            return {"meta": {"results": {"total": 0}}, "results": []}  # openFDA: no matches
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt == 2:
                raise FDAError(f"FDA API returned HTTP {resp.status_code}")
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        if resp.status_code >= 400:
            try:
                msg = resp.json().get("error", {}).get("message") or resp.text[:200]
            except ValueError:
                msg = resp.text[:200]
            raise FDAError(f"FDA API error {resp.status_code}: {msg}")
        return resp.json()
    raise FDAError("FDA API request failed")


# ----------------------------------------------------------------- normalise
def _first(values: Any) -> str | None:
    if isinstance(values, list):
        return str(values[0]).strip() if values else None
    return str(values).strip() if values else None


def _titlecase(text: str | None) -> str | None:
    if not text:
        return None
    if text.isupper() or text.islower():
        return " ".join(w if any(c.isdigit() for c in w) else w.capitalize() for w in text.split())
    return text


def _uniq(items: list[str | None]) -> list[str]:
    out: list[str] = []
    for i in items:
        if i and i.strip() and i.strip() not in out:
            out.append(i.strip())
    return out


def _fda_date(value: str | None) -> str | None:
    if value and re.fullmatch(r"\d{8}", value):
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return None


def clean_indication(text: str | None) -> str | None:
    if not text:
        return None
    t = re.sub(r"\s+", " ", text).strip()
    t = re.sub(r"^(\d+(\.\d+)?\s*)?INDICATIONS?\s*(AND|&)\s*USAGE:?\s*", "", t, flags=re.I)
    return t or None


def label_summary(label: dict) -> dict[str, Any]:
    """The few label fields we keep (labels are large; we never store them whole)."""
    of = label.get("openfda") or {}
    indication_full = clean_indication(_first(label.get("indications_and_usage")))
    return {
        "set_id": label.get("set_id"),
        "effective_time": label.get("effective_time"),
        "application_numbers": [a for a in of.get("application_number", []) if a[:3] in ("NDA", "BLA")],
        "brand_name": _first(of.get("brand_name")),
        "generic_name": _first(of.get("generic_name")),
        "manufacturer": _first(of.get("manufacturer_name")),
        "substance": "; ".join(_uniq([_titlecase(x) for x in of.get("substance_name", [])])) or None,
        "route": "; ".join(_uniq([_titlecase(x) for x in of.get("route", [])])) or None,
        "pharm_class": _uniq(of.get("pharm_class_epc", []))[:8],
        "indication_full": indication_full,
    }


def application_summary(app: dict | None) -> dict[str, Any]:
    if not app:
        return {}
    products = app.get("products") or []
    subs = app.get("submissions") or []
    approved = [s for s in subs if s.get("submission_status") == "AP"]
    orig = [s for s in approved if s.get("submission_type") == "ORIG"]
    approval = min((s.get("submission_status_date") for s in orig if s.get("submission_status_date")), default=None)
    latest = max((s.get("submission_status_date") for s in approved if s.get("submission_status_date")), default=None)
    tentative = any(s.get("submission_status") == "TA" for s in subs)
    ingredients = _uniq([_titlecase(ai.get("name")) for p in products for ai in (p.get("active_ingredients") or [])])
    strengths = _uniq([ai.get("strength") for p in products for ai in (p.get("active_ingredients") or [])])
    status = "Approved" if orig else ("Tentative approval" if tentative else ("Approved (supplement on record)" if approved else None))
    return {
        "sponsor": _titlecase(app.get("sponsor_name")),
        "brand_name": _titlecase(_first([p.get("brand_name") for p in products if p.get("brand_name")])),
        "active_ingredient": "; ".join(ingredients) or None,
        "strength": "; ".join(strengths)[:500] or None,
        "dosage_form": "; ".join(_uniq([_titlecase(p.get("dosage_form")) for p in products])) or None,
        "route": "; ".join(_uniq([_titlecase(p.get("route")) for p in products])) or None,
        "marketing_status": "; ".join(_uniq([p.get("marketing_status") for p in products])) or None,
        "fda_status": status,
        "approval_date": _fda_date(approval),
        "latest_action_date": _fda_date(latest),
    }


def record_hash(row: dict[str, Any]) -> str:
    keep = {k: v for k, v in row.items() if k not in ("record_hash", "classification")}
    return hashlib.sha256(json.dumps(keep, sort_keys=True, default=str).encode()).hexdigest()


def build_drug(app_no: str, label: dict[str, Any], app: dict[str, Any]) -> dict[str, Any]:
    flags: list[str] = []
    if not app:
        flags.append("No Drugs@FDA record for this application (often a CBER-regulated biologic); approval details not available from FDA data.")
    elif not app.get("approval_date"):
        flags.append("No original approval date found in Drugs@FDA.")
    indication_full = label.get("indication_full")
    indication = indication_full
    if indication and len(indication) > 4000:
        indication = indication[:4000].rsplit(" ", 1)[0] + " …"
        flags.append("Indication text shortened; see the FDA label for the full text.")
    digits = re.sub(r"\D", "", app_no)
    brand = label.get("brand_name") or app.get("brand_name")
    generic = _titlecase(label.get("generic_name"))
    row = {
        "application_number": app_no,
        "application_type": app_no[:3],
        "drug_name": _titlecase(brand) or generic or app_no,
        "brand_name": _titlecase(brand),
        "generic_name": generic,
        "active_ingredient": app.get("active_ingredient") or label.get("substance"),
        "manufacturer": app.get("sponsor") or _titlecase(label.get("manufacturer")),
        "dosage_form": app.get("dosage_form"),
        "strength": app.get("strength"),
        "route": app.get("route") or label.get("route"),
        "indication": indication,
        "pharm_class": label.get("pharm_class") or [],
        "fda_status": app.get("fda_status"),
        "approval_date": app.get("approval_date"),
        "latest_action_date": app.get("latest_action_date"),
        "marketing_status": app.get("marketing_status"),
        "label_set_id": label.get("set_id"),
        "label_effective_date": _fda_date(label.get("effective_time")),
        "fda_source": SOURCE_NAME,
        "fda_source_url": f"https://api.fda.gov/drug/drugsfda.json?search=application_number:{app_no}"
        if app else f"https://api.fda.gov/drug/label.json?search=set_id:{label.get('set_id')}",
        "drugs_at_fda_url": f"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={digits}"
        if app else None,
        "label_url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={label['set_id']}" if label.get("set_id") else None,
        "review_flags": flags,
    }
    row["record_hash"] = record_hash(row)
    row["classification"] = classify(indication_full).as_dict()
    return row


# ----------------------------------------------------------------- sync runner
@dataclass
class SyncStore:
    """DB operations for a sync, so the runner works for an Admin session or
    an automation token (and can be faked in tests)."""
    write: Callable[[list[dict], str | None], Awaitable[dict]]
    save_run: Callable[[dict], Awaitable[str]]


async def run_sync_chunk(
    store: SyncStore,
    run: dict[str, Any] | None,
    mode: str = "FULL",
    trigger: str = "MANUAL",
    since: date | None = None,
    budget_seconds: float = 38.0,
) -> dict[str, Any]:
    """Process label pages until the time budget is used. Returns progress."""
    started = time.monotonic()
    if run is None:
        cursor = {"streams": build_streams(since if mode == "INCREMENTAL" else None), "i": 0, "seen": {}}
        run_id = await store.save_run({"mode": mode, "trigger": trigger, "cursor": cursor})
        run = {"id": run_id, "cursor": cursor}
    run_id = run["id"]
    cursor = run["cursor"]
    totals = {"new": 0, "updated": 0, "unchanged": 0, "failed": 0, "fetched": 0}
    errors: list[str] = []
    source_updated: str | None = None
    done = False

    async with _client() as client:
        while time.monotonic() - started < budget_seconds:
            streams = cursor["streams"]
            if cursor["i"] >= len(streams):
                done = True
                break
            stream = streams[cursor["i"]]
            if stream["total"] is not None and stream["skip"] >= min(stream["total"], 25000):
                cursor["i"] += 1
                continue
            try:
                page = await fda_get(client, "label", stream["q"], LABEL_PAGE, stream["skip"])
            except FDAError as exc:
                errors.append(str(exc))
                totals["failed"] += 1
                break
            meta = page.get("meta") or {}
            stream["total"] = (meta.get("results") or {}).get("total", 0)
            source_updated = meta.get("last_updated") or source_updated
            labels = [label_summary(lb) for lb in page.get("results") or []]
            stream["skip"] += LABEL_PAGE
            totals["fetched"] += len(labels)

            # newest label per application, skipping ones already handled this run with a newer label
            by_app: dict[str, dict] = {}
            for lb in labels:
                for app_no in lb["application_numbers"]:
                    eff = lb.get("effective_time") or ""
                    if cursor["seen"].get(app_no, "") >= eff and app_no in cursor["seen"]:
                        continue
                    if app_no not in by_app or (by_app[app_no].get("effective_time") or "") < eff:
                        by_app[app_no] = lb
            if not by_app:
                continue

            apps: dict[str, dict] = {}
            app_numbers = list(by_app)
            try:
                for i in range(0, len(app_numbers), APPLICATIONS_PER_QUERY):
                    chunk = app_numbers[i:i + APPLICATIONS_PER_QUERY]
                    res = await fda_get(client, "drugsfda", "application_number:(" + " OR ".join(chunk) + ")",
                                        len(chunk))
                    for a in res.get("results") or []:
                        apps[a.get("application_number")] = application_summary(a)
            except FDAError as exc:
                errors.append(str(exc))
                totals["failed"] += len(by_app)
                stream["skip"] -= LABEL_PAGE  # retry this page next time
                break

            drugs = []
            for app_no, lb in by_app.items():
                try:
                    drugs.append(build_drug(app_no, lb, apps.get(app_no, {})))
                except Exception as exc:  # one bad record must not stop the sync
                    log.exception("could not normalise %s", app_no)
                    errors.append(f"{app_no}: {exc}")
                    totals["failed"] += 1
            if drugs:
                result = await store.write(drugs, _fda_date(source_updated))
                for k in ("new", "updated", "unchanged"):
                    totals[k] += int(result.get(k, 0))
                for app_no, lb in by_app.items():
                    cursor["seen"][app_no] = lb.get("effective_time") or ""

    status = None
    if done:
        status = "PARTIAL" if (totals["failed"] or errors) else "SUCCESS"
    elif errors and totals["fetched"] == 0:
        status = "FAILED"
    update: dict[str, Any] = {"id": run_id, **totals, "cursor": cursor, "source_last_updated": _fda_date(source_updated)}
    if errors:
        update["errors"] = errors[:20]
    if status:
        update["status"] = status
        update["finished"] = True
    await store.save_run(update)
    remaining = sum(max(0, min(s["total"] or 0, 25000) - s["skip"]) for s in cursor["streams"][cursor["i"]:]
                    if s["total"] is not None)
    return {"run_id": run_id, "done": done or status == "FAILED", "status": status or "RUNNING", **totals,
            "errors": errors[:5], "stream": cursor["i"], "streams": len(cursor["streams"]), "remaining_estimate": remaining}


def incremental_since(last_success: dict | None) -> date | None:
    if not last_success or not last_success.get("started_at"):
        return None
    started = datetime.fromisoformat(str(last_success["started_at"]).replace("Z", "+00:00"))
    return (started.astimezone(timezone.utc) - timedelta(days=3)).date()


def sync_due(settings: dict | None, last_success: dict | None, now: datetime | None = None) -> bool:
    schedule = ((settings or {}).get("schedule") or "weekly").lower()
    if schedule == "manual":
        return False
    if not last_success or not last_success.get("finished_at"):
        return True
    now = now or datetime.now(timezone.utc)
    finished = datetime.fromisoformat(str(last_success["finished_at"]).replace("Z", "+00:00"))
    return now - finished >= (timedelta(hours=20) if schedule == "daily" else timedelta(days=6, hours=20))


def label_url_for(set_id: str) -> str:
    return f"https://api.fda.gov/drug/label.json?search=set_id:{quote(set_id)}"
