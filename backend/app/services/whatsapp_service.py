"""Cunnekt WhatsApp Business API (https://docs.cunnekt.com).

- POST {base}sendtemplate   approved WhatsApp template (any time)
- POST {base}replymessage   free-form text (only inside the 24-hour service window)
Auth header: API-KEY. Results are whatever Cunnekt returns; nothing is simulated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import get_settings


class ProviderNotConfigured(Exception):
    pass


@dataclass
class ProviderResult:
    ok: bool
    provider_message_id: str | None = None
    error: str | None = None
    response: dict[str, Any] = field(default_factory=dict)


def whatsapp_number(phone: str | None) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10 and digits[0] in "6789":
        return "91" + digits
    if len(digits) == 11 and digits.startswith("0"):
        return "91" + digits[1:]
    if 11 <= len(digits) <= 15:
        return digits
    return None


def _parse(resp: httpx.Response) -> ProviderResult:
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text[:1000]}
    if not isinstance(body, dict):
        body = {"raw": body}
    msg_id = None
    msgs = body.get("messages")
    if isinstance(msgs, list) and msgs and isinstance(msgs[0], dict):
        msg_id = msgs[0].get("id")
    msg_id = msg_id or body.get("message_id") or body.get("id")
    error = None
    err = body.get("error") or body.get("errors")
    if isinstance(err, dict):
        error = err.get("message") or err.get("error_user_msg") or err.get("title") or str(err)
    elif isinstance(err, list) and err:
        error = str(err[0].get("message") or err[0].get("title") or err[0]) if isinstance(err[0], dict) else str(err[0])
    elif isinstance(err, str):
        error = err
    status_flag = str(body.get("status", "")).lower()
    if resp.status_code >= 400 or error or status_flag in ("error", "failed", "false") or not msg_id:
        error = error or body.get("message") or body.get("msg") or (
            f"HTTP {resp.status_code}" + ("" if msg_id else " (no message id returned)"))
        return ProviderResult(False, msg_id, str(error)[:500], body)
    return ProviderResult(True, str(msg_id), None, body)


async def _post(path: str, payload: dict[str, Any]) -> ProviderResult:
    s = get_settings()
    if not s.cunnekt_api_key:
        raise ProviderNotConfigured("CUNNEKT_API_KEY is not configured on the server.")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0)) as client:
            resp = await client.post(
                s.cunnekt_base_url + path, json=payload,
                headers={"API-KEY": s.cunnekt_api_key, "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        return ProviderResult(False, None, f"Could not reach Cunnekt: {exc}", {})
    return _parse(resp)


async def send_text(to: str, body: str) -> ProviderResult:
    return await _post("replymessage", {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": to,
        "type": "text", "text": {"preview_url": False, "body": body[:4096]},
    })


async def send_template(to: str, template_name: str, language: str, params: list[str]) -> ProviderResult:
    template: dict[str, Any] = {"name": template_name, "language": {"code": language or "en"}}
    if params:
        template["components"] = [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]
    return await _post("sendtemplate", {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": to,
        "type": "template", "template": template,
    })


def parse_webhook(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Delivery receipts (Meta Cloud API format, as Cunnekt forwards them)."""
    events = []
    entries = payload.get("entry") if isinstance(payload, dict) else None
    values = []
    if isinstance(entries, list):
        for e in entries:
            for ch in (e or {}).get("changes") or []:
                values.append((ch or {}).get("value") or {})
    elif isinstance(payload, dict) and "statuses" in payload:
        values.append(payload)
    for v in values:
        for st in v.get("statuses") or []:
            if not isinstance(st, dict) or not st.get("id"):
                continue
            err = None
            if st.get("errors"):
                e0 = st["errors"][0] if isinstance(st["errors"], list) else st["errors"]
                err = (e0.get("message") or e0.get("title") or str(e0)) if isinstance(e0, dict) else str(e0)
            ts = st.get("timestamp")
            occurred = None
            if ts and str(ts).isdigit():
                from datetime import datetime, timezone
                occurred = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            events.append({
                "provider_message_id": st["id"], "status": str(st.get("status", "")).upper(),
                "occurred_at": occurred, "error": err, "payload": st,
            })
    return events
