"""OpenRouter: drafting messages and (optionally) classifying unclear drugs.

The model only rewrites structure and tone. Facts come from the FDA record
passed in; output is checked so figures not present in the FDA data send
the draft to NEEDS_REVIEW. Every call is recorded in ai_runs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from ..core.config import get_settings
from .whatsapp_service import ProviderNotConfigured

PROMPT_VERSION = "fda-msg-v1"
CLASSIFY_PROMPT_VERSION = "fda-classify-v1"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are a pharmaceutical communication assistant for Ikris Pharma Network.

Use only the supplied structured FDA and scientific data.
FDA regulatory information is authoritative. KEGG data, if present, is secondary and must not override FDA data.

Do not invent:
- FDA approvals
- approval dates
- indications
- clinical trial results
- efficacy
- safety claims
- dosage
- contraindications
- statistics

Do not provide medical advice.
Generate professional communication intended for healthcare professionals.
Copy drug names, active ingredients, FDA status and approval dates exactly as supplied.
Do not add numbers, percentages or dates that are not in the supplied data.
If required information is missing or contradictory, return NEEDS_REVIEW.
Never fabricate information.

You may personalise only: greeting, tone, message structure, call to action and conciseness,
based on the doctor's specialty, hospital, department, the drug, the channel and the template.

Reply with JSON only:
{"status": "OK" | "NEEDS_REVIEW", "subject": "<email subject or empty for WhatsApp>",
 "body": "<message>", "reason": "<why NEEDS_REVIEW, else empty>"}
For WhatsApp: plain text, no markdown, at most 900 characters.
For Email: simple HTML using <p>, <ul>, <li>, <strong> only; subject at most 120 characters."""

CLASSIFY_SYSTEM = """You classify FDA drugs into one therapeutic area using ONLY the FDA label indication text given.
Areas: ONCOLOGY, HEMATOLOGY, RARE_DISEASE, OTHER.
You must quote, word for word, the part of the indication that supports your answer.
If the text does not clearly support one area, answer NEEDS_REVIEW.
Reply with JSON only: {"department": "...", "confidence": 0.0-1.0, "evidence_quote": "...", "reason": "..."}"""


@dataclass
class AIResult:
    status: str  # OK / NEEDS_REVIEW / FAILED
    subject: str | None
    body: str
    reason: str | None
    model: str
    usage: dict[str, Any] | None
    raw: str


def _extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                return None
    return None


async def _chat(system: str, user: str, max_tokens: int = 1200) -> tuple[str, dict | None, str]:
    s = get_settings()
    if not s.openrouter_api_key:
        raise ProviderNotConfigured("OPENROUTER_API_KEY is not configured on the server.")
    headers = {
        "Authorization": f"Bearer {s.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": s.app_url or "https://ikris-doctor-connect.vercel.app",
        "X-Title": "IKRIS Doctor Connect",
    }
    payload = {
        "model": s.openrouter_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
        resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
    if resp.status_code >= 400:
        try:
            msg = resp.json().get("error", {}).get("message") or resp.text[:300]
        except ValueError:
            msg = resp.text[:300]
        raise RuntimeError(f"OpenRouter error {resp.status_code}: {msg}")
    data = resp.json()
    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return content, data.get("usage"), data.get("model") or s.openrouter_model


def facts_payload(doctor: dict, drug: dict, kegg: dict | None, channel: str, objective: str | None,
                  template_text: str | None, sender: dict | None) -> dict[str, Any]:
    return {
        "doctor": {k: doctor.get(k) for k in ("doctor_name", "specialty", "institute", "department", "sub_department", "city")},
        "fda_drug": {k: drug.get(k) for k in (
            "drug_name", "brand_name", "generic_name", "active_ingredient", "manufacturer", "dosage_form", "route",
            "indication", "therapeutic_area", "fda_status", "approval_date", "marketing_status", "application_number")},
        "kegg_reference": kegg or None,
        "channel": channel,
        "message_objective": objective or "Share an FDA drug information update and offer help with availability or patient access.",
        "approved_template": template_text or None,
        "sender": sender or {},
    }


async def generate_message(payload: dict[str, Any]) -> AIResult:
    user = "Write the message from this data:\n" + json.dumps(payload, ensure_ascii=False, default=str)
    try:
        content, usage, model = await _chat(SYSTEM_PROMPT, user)
    except ProviderNotConfigured:
        raise
    except Exception as exc:
        return AIResult("FAILED", None, "", str(exc)[:400], get_settings().openrouter_model, None, "")
    data = _extract_json(content)
    if not data or not isinstance(data.get("body", ""), str):
        return AIResult("FAILED", None, "", "The AI reply was not in the expected format.", model, usage, content[:4000])
    status = "NEEDS_REVIEW" if str(data.get("status", "")).upper() == "NEEDS_REVIEW" else "OK"
    return AIResult(status, (data.get("subject") or None), data.get("body") or "", data.get("reason") or None,
                    model, usage, content[:4000])


async def classify_with_ai(indication: str) -> tuple[dict[str, Any] | None, str, dict | None, str]:
    content, usage, model = await _chat(CLASSIFY_SYSTEM, "FDA indication:\n" + indication[:6000], max_tokens=400)
    return _extract_json(content), model, usage, content[:2000]
