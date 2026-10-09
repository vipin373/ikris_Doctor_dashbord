"""Doctor -> therapeutic areas -> relevant FDA drugs."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from .drug_classifier import AREA_LABEL, HEMATOLOGY, ONCOLOGY, RARE_DISEASE

SENDABLE_CLASSIFICATION = ("CLASSIFIED", "APPROVED")
DRUG_COLUMNS = (
    "id,application_number,drug_name,brand_name,generic_name,active_ingredient,manufacturer,dosage_form,strength,route,"
    "indication,therapeutic_area,therapeutic_areas,department,classification_status,fda_status,approval_date,"
    "latest_action_date,marketing_status,fda_source,fda_source_url,drugs_at_fda_url,label_url,last_synced_at,"
    "retrieved_at,review_flags"
)


def doctor_areas(doctor: dict[str, Any]) -> list[str]:
    """Areas a doctor practises in, from department, sub-department and specialty."""
    areas: set[str] = set()
    sub = (doctor.get("sub_department") or "").lower()
    spec = " ".join(str(doctor.get(k) or "") for k in ("specialty", "qualification")).lower()
    if doctor.get("department") == "RARE_DISEASES":
        areas.add(RARE_DISEASE)
    if "onco" in sub or re.search(r"\bonc|oncolog|cancer|tumou?r", spec):
        areas.add(ONCOLOGY)
    if "hema" in sub or "haema" in sub or re.search(r"\bhema|haema|hemato|haemato|\bbmt\b|blood", spec):
        areas.add(HEMATOLOGY)
    if re.search(r"genetic|rare disease|metabolic|lysosomal", spec):
        areas.add(RARE_DISEASE)
    return sorted(areas, key=lambda a: [ONCOLOGY, HEMATOLOGY, RARE_DISEASE].index(a))


def areas_label(areas: list[str]) -> str:
    return " + ".join(AREA_LABEL[a] for a in areas) if areas else "General (no specialty match)"


def eligibility(doctor: dict[str, Any], since: datetime | None = None, now: datetime | None = None) -> tuple[bool, str | None]:
    """A doctor is blocked until next_eligible_at, unless that window was
    opened by this same campaign (e.g. the email after the WhatsApp)."""
    nxt = doctor.get("next_eligible_at")
    if not nxt:
        return True, None
    now = now or datetime.now(timezone.utc)
    nxt_dt = datetime.fromisoformat(str(nxt).replace("Z", "+00:00"))
    if nxt_dt <= now:
        return True, None
    last = doctor.get("last_message_sent_at")
    if since and last and datetime.fromisoformat(str(last).replace("Z", "+00:00")) >= since:
        return True, None
    return False, nxt_dt.isoformat()


def drug_sendable(drug: dict[str, Any]) -> str | None:
    """Reason the drug cannot be used in a message, or None."""
    if drug.get("classification_status") not in SENDABLE_CLASSIFICATION:
        return "Drug classification requires review."
    if not drug.get("fda_status"):
        return "FDA approval status is not available for this drug."
    return None


def drug_relevant(drug: dict[str, Any], areas: list[str]) -> bool:
    return bool(set(drug.get("therapeutic_areas") or []) & set(areas))


async def recommend(db, doctor: dict[str, Any], limit: int = 12, q: str | None = None) -> dict[str, Any]:
    areas = doctor_areas(doctor)
    if not areas:
        return {"areas": [], "areas_label": areas_label([]), "items": [],
                "note": "This doctor has no oncology, hematology or rare-disease specialty on record, "
                        "so no drug is matched automatically."}
    params: list[tuple[str, str]] = [
        ("select", DRUG_COLUMNS),
        ("therapeutic_areas", "ov.{" + ",".join(areas) + "}"),
        ("classification_status", f"in.({','.join(SENDABLE_CLASSIFICATION)})"),
        ("fda_status", "not.is.null"),
        ("order", "latest_action_date.desc.nullslast,drug_name.asc"),
        ("limit", "200"),
    ]
    if q:
        params.append(("search_text", f"ilike.*{q.lower().strip()}*"))
    drugs, _ = await db.select("fda_drugs", params)
    sent, _ = await db.select("message_logs", [
        ("select", "drug_id,sent_at"), ("doctor_id", f"eq.{doctor['id']}"), ("status", "in.(SENT,DELIVERED,READ)"),
        ("order", "sent_at.desc"), ("limit", "500"),
    ])
    last_sent: dict[str, str] = {}
    for s in sent:
        if s.get("drug_id") and s["drug_id"] not in last_sent:
            last_sent[s["drug_id"]] = s["sent_at"]
    for d in drugs:
        d["last_sent_to_doctor"] = last_sent.get(d["id"])
        d["matched_areas"] = [a for a in d.get("therapeutic_areas") or [] if a in areas]
    # Prefer drugs this doctor has not been told about, then the most recent FDA action.
    drugs.sort(key=lambda d: (d["last_sent_to_doctor"] is not None, d["last_sent_to_doctor"] or ""))
    return {"areas": areas, "areas_label": areas_label(areas), "items": drugs[:limit]}


def pick_auto_drug(candidates: list[dict[str, Any]], used_counts: dict[str, int]) -> dict[str, Any] | None:
    """First drug not yet sent to this doctor; spread a bulk campaign across drugs."""
    fresh = [d for d in candidates if not d.get("last_sent_to_doctor")]
    pool = fresh or candidates
    if not pool:
        return None
    top = pool[:5]
    return min(top, key=lambda d: (used_counts.get(d["id"], 0), top.index(d)))
