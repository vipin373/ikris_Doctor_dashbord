"""Template variables and rendering.

FDA variables are filled only from the stored FDA record. A variable with no
value is reported, never guessed, and a message with unresolved variables
cannot be approved.
"""

from __future__ import annotations

import html
import re
from datetime import date
from typing import Any

from .drug_classifier import AREA_LABEL

VARIABLES: list[tuple[str, str, str]] = [
    # (name, group, description)
    ("doctor_name", "Doctor", "Doctor's name, with Dr. prefix"),
    ("hospital_name", "Doctor", "Hospital / institute"),
    ("specialty", "Doctor", "Specialty"),
    ("department", "Doctor", "Department"),
    ("city", "Doctor", "City"),
    ("drug_name", "FDA", "Drug name (FDA)"),
    ("brand_name", "FDA", "Brand name (FDA)"),
    ("active_ingredient", "FDA", "Active ingredient (FDA)"),
    ("indication", "FDA", "Indication, short (first part of the FDA label indication)"),
    ("indication_full", "FDA", "Indication, full FDA label text (long; best for email)"),
    ("therapeutic_area", "FDA", "Therapeutic area"),
    ("fda_status", "FDA", "FDA status"),
    ("fda_approval_date", "FDA", "FDA approval date"),
    ("manufacturer", "FDA", "Manufacturer / applicant (FDA)"),
    ("sender_name", "Sender", "Sender name"),
    ("sender_phone", "Sender", "Sender phone"),
    ("sender_email", "Sender", "Sender email"),
]
VARIABLE_NAMES = {v[0] for v in VARIABLES}
FDA_VARIABLES = {v[0] for v in VARIABLES if v[1] == "FDA"}
TAG_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
DEPARTMENT_NAME = {"NPP": "NPP", "RARE_DISEASES": "Rare Diseases"}


def doctor_display_name(name: str | None) -> str | None:
    if not name or not name.strip():
        return None
    n = re.sub(r"\s+", " ", name).strip()
    return n if re.match(r"^dr\.?\s", n, re.I) else f"Dr. {n}"


def _fmt_date(value: Any) -> str | None:
    if not value:
        return None
    try:
        d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
    return d.strftime("%d %b %Y")


SECTION_REF = re.compile(r"\(\s*\d+(?:\.\d+)*\s*\)|\b(?:Studies with|Limitations of Use|Limitation of Use|The effects diminish)\b", re.I)


def indication_summary(text: str | None, limit: int = 320) -> str | None:
    """The opening of the FDA indication, verbatim, cut before section references,
    study details and limitations. Never rewritten, only shortened."""
    if not text or not text.strip():
        return None
    t = re.sub(r"\s+", " ", text).strip()
    m = SECTION_REF.search(t)
    if m and m.start() > 40:
        t = t[:m.start()].rstrip(" ;:,")
    if len(t) > limit:
        cut = t[:limit]
        end = max(cut.rfind(". "), cut.rfind("; "))
        t = (cut[:end + 1] if end > 80 else cut.rsplit(" ", 1)[0]).rstrip(" ;:,") + " …"
    elif not t.endswith((".", "…")):
        t += "."
    return t


def context_for(doctor: dict | None, drug: dict | None, sender: dict | None) -> dict[str, str | None]:
    doctor = doctor or {}
    drug = drug or {}
    sender = sender or {}
    area = drug.get("therapeutic_area") or AREA_LABEL.get(drug.get("department") or "")
    return {
        "doctor_name": doctor_display_name(doctor.get("doctor_name")),
        "hospital_name": doctor.get("institute"),
        "specialty": doctor.get("specialty") or doctor.get("sub_department"),
        "department": doctor.get("sub_department") or DEPARTMENT_NAME.get(doctor.get("department") or ""),
        "city": doctor.get("city"),
        "drug_name": drug.get("drug_name"),
        "brand_name": drug.get("brand_name"),
        "active_ingredient": drug.get("active_ingredient") or drug.get("generic_name"),
        "indication": indication_summary(drug.get("indication")),
        "indication_full": drug.get("indication"),
        "therapeutic_area": area,
        "fda_status": drug.get("fda_status"),
        "fda_approval_date": _fmt_date(drug.get("approval_date")),
        "manufacturer": drug.get("manufacturer"),
        "sender_name": sender.get("name") or None,
        "sender_phone": sender.get("phone") or None,
        "sender_email": sender.get("email") or None,
    }


def render(text: str | None, ctx: dict[str, str | None], escape_html: bool = False) -> tuple[str, list[str], list[str]]:
    """Returns (rendered, missing variables, unknown variables)."""
    missing: list[str] = []
    unknown: list[str] = []

    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name not in VARIABLE_NAMES:
            unknown.append(name)
            return m.group(0)
        value = ctx.get(name)
        if value is None or str(value).strip() == "":
            missing.append(name)
            return m.group(0)
        value = str(value)
        return html.escape(value) if escape_html else value

    out = TAG_RE.sub(sub, text or "")
    return out, sorted(set(missing)), sorted(set(unknown))


def unresolved(text: str | None) -> list[str]:
    return sorted({m.group(1) for m in TAG_RE.finditer(text or "")})


def looks_like_html(text: str | None) -> bool:
    return bool(re.search(r"<\s*(p|div|br|table|ul|ol|li|strong|h[1-6]|a)\b", text or "", re.I))


def plain_to_html(text: str) -> str:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    return "".join(f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in paras)


def html_to_text(body: str) -> str:
    t = re.sub(r"<\s*br\s*/?>", "\n", body, flags=re.I)
    t = re.sub(r"</\s*(p|div|h[1-6]|li|tr)\s*>", "\n\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def email_document(body_html: str, drug: dict | None, sender: dict | None) -> str:
    """Wraps the approved body in the Ikris email layout with the FDA source footer."""
    sender = sender or {}
    source = ""
    if drug:
        links = []
        if drug.get("drugs_at_fda_url"):
            links.append(f'<a href="{html.escape(drug["drugs_at_fda_url"])}" style="color:#172A5C">Drugs@FDA</a>')
        if drug.get("label_url"):
            links.append(f'<a href="{html.escape(drug["label_url"])}" style="color:#172A5C">FDA label</a>')
        retrieved = _fmt_date(drug.get("last_synced_at") or drug.get("retrieved_at"))
        source = (
            '<p style="margin:16px 0 0;font-size:11px;color:#6b7280">Source: U.S. Food and Drug Administration'
            + (f" ({' · '.join(links)})" if links else "")
            + (f", retrieved {retrieved}" if retrieved else "")
            + ". This information is intended for healthcare professionals.</p>"
        )
    contact = " · ".join(html.escape(x) for x in (sender.get("phone"), sender.get("email")) if x)
    return (
        '<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 0">'
        '<tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">'
        '<tr><td style="background:#172A5C;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:bold">'
        f'{html.escape(sender.get("name") or "Ikris Pharma Network")}</td></tr>'
        f'<tr><td style="padding:24px;font-size:14px;line-height:1.6;color:#1f2937">{body_html}{source}</td></tr>'
        '<tr><td style="padding:12px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">'
        f'{html.escape(sender.get("name") or "Ikris Pharma Network")}{" · " + contact if contact else ""}</td></tr>'
        '</table></td></tr></table></body></html>'
    )


NUMBER_RE = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?%?")


def fact_guard(generated: str, allowed_sources: list[str | None]) -> list[str]:
    """Numbers / percentages / years in AI text must exist in the supplied data."""
    haystack = " ".join(s for s in allowed_sources if s)
    haystack_digits = {re.sub(r"[,]", "", m) for m in NUMBER_RE.findall(haystack)}
    issues = []
    for m in NUMBER_RE.findall(html_to_text(generated)):
        token = re.sub(r"[,]", "", m)
        if token.rstrip("%") in {"1", "2", "3"} and not token.endswith("%"):
            continue  # list numbering and the like
        if token not in haystack_digits and token.rstrip("%") not in haystack_digits:
            issues.append(m)
    return sorted(set(issues))
