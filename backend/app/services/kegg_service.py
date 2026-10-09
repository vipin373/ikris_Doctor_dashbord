"""KEGG DRUG as a secondary scientific reference (optional).

Enabled only when KEGG_API_BASE_URL is set (e.g. https://rest.kegg.jp).
Note: the KEGG REST API is free for academic use; commercial use needs a
licence from KEGG/Pathway Solutions. KEGG never overrides FDA data: when it
suggests a different therapeutic area the record is flagged for review.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..core.config import get_settings
from .drug_classifier import find_terms
from .whatsapp_service import ProviderNotConfigured


def enabled() -> bool:
    return bool(get_settings().kegg_api_base_url)


def _parse_entry(text: str) -> dict[str, str]:
    fields: dict[str, list[str]] = {}
    key = None
    for line in text.splitlines():
        if not line.strip() or line.startswith("///"):
            continue
        if line[:12].strip():
            key = line[:12].strip()
            fields.setdefault(key, []).append(line[12:].strip())
        elif key:
            fields[key].append(line[12:].strip())
    return {k: " ".join(v) for k, v in fields.items()}


async def lookup(name: str) -> dict[str, Any] | None:
    base = get_settings().kegg_api_base_url
    if not base:
        raise ProviderNotConfigured("KEGG_API_BASE_URL is not configured on the server.")
    term = re.sub(r"[^A-Za-z0-9 -]", " ", name).strip()
    if not term:
        return None
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
        found = await client.get(f"{base}/find/drug/{term}")
        found.raise_for_status()
        first = next((ln for ln in found.text.splitlines() if ln.startswith("dr:")), None)
        if not first:
            return None
        kegg_id = first.split("\t")[0].replace("dr:", "")
        entry = await client.get(f"{base}/get/{kegg_id}")
        entry.raise_for_status()
    f = _parse_entry(entry.text)
    indication = " ".join(x for x in (f.get("EFFICACY"), f.get("DISEASE")) if x) or None
    areas = sorted(find_terms(indication or "").keys())
    return {
        "kegg_id": kegg_id,
        "drug_name": (f.get("NAME") or "").split(";")[0].strip() or None,
        "active_ingredient": f.get("COMPONENT") or None,
        "indication": indication[:2000] if indication else None,
        "therapeutic_area": ", ".join(areas) or None,
        "kegg_source_url": f"https://www.kegg.jp/entry/{kegg_id}",
        "areas": areas,
    }


def conflict_with_fda(kegg_areas: list[str], fda_areas: list[str]) -> str | None:
    if not kegg_areas or not fda_areas:
        return None
    if not set(kegg_areas) & set(fda_areas):
        return (f"KEGG suggests {', '.join(kegg_areas)} but FDA classification is {', '.join(fda_areas)}. "
                "FDA takes priority; please review.")
    return None
