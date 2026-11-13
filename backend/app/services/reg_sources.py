"""EMA and PMDA drug records for the shared drug-communication pipeline (table fda_drugs).

EMA:  the official "Medicines" data file (nightly). Authorised human medicines only.
      Reuse is allowed with acknowledgement: "Source: European Medicines Agency (EMA)".
PMDA: the English "List of Approved Products" PDF. PMDA content is under the Public Data
      License 1.0 (cite the source, mark edits) but automated downloading is not allowed,
      so an admin downloads the PDF from the PMDA website and uploads it here.

Rows have the same shape as FDA rows so classification, the India (CDSCO) check,
doctor matching, templates and sending work unchanged. Nothing is invented: a field
the source does not state stays empty.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from typing import Any

from .drug_classifier import CLASSIFIER_VERSION, classify
from .fda_service import record_hash

EMA_FILE_URL = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx"
EMA_PAGE_URL = "https://www.ema.europa.eu/en/medicines/download-medicine-data"
EMA_SOURCE = "EMA medicines data (Source: European Medicines Agency)"
PMDA_PAGE_URL = "https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0002.html"
PMDA_REPORTS_URL = "https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0001.html"
PMDA_SOURCE = "PMDA List of Approved Products (Source: PMDA; table extracted by Ikris)"


def _d(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    s = re.sub(r"\s+", " ", str(value)).strip()
    s = s.replace("Sept.", "Sep.").replace("June", "Jun.").replace("July", "Jul.")
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y", "%b. %d, %Y", "%b %d, %Y", "%B %d, %Y", "%b.%d, %Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _yes(v: Any) -> bool:
    return str(v or "").strip().lower() == "yes"


def _clean(v: Any) -> str | None:
    s = re.sub(r"\s+", " ", str(v or "")).strip()
    return s or None


def _finish(row: dict[str, Any], indication: str | None) -> dict[str, Any]:
    row["classifier"] = CLASSIFIER_VERSION
    row["record_hash"] = record_hash(row)
    row["classification"] = classify(indication).as_dict()
    return row


# ------------------------------------------------------------------ EMA
def ema_rows(content: bytes) -> tuple[list[dict], list[dict]]:
    """Authorised human medicines from the EMA file, one row per EMA product."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    header: list[str] | None = None
    rows: list[dict] = []
    skipped: list[dict] = []
    for raw in wb.active.iter_rows(values_only=True):
        if header is None:
            if raw and raw[0] == "Category" and "EMA product number" in raw:
                header = [str(h or "").replace("\n", " ").strip() for h in raw]
            continue
        r = dict(zip(header, raw))
        if r.get("Category") != "Human" or str(r.get("Medicine status") or "").strip() != "Authorised":
            continue
        number = _clean(r.get("EMA product number"))
        name = _clean(r.get("Name of medicine"))
        if not number or not name:
            skipped.append({"name": name or number, "error": "No product number or name"})
            continue
        inn = _clean(r.get("International non-proprietary name (INN) / common name"))
        indication = _clean(r.get("Therapeutic indication"))
        flags = []
        if _yes(r.get("Conditional approval")):
            flags.append("Conditional marketing authorisation (EU).")
        if _yes(r.get("Exceptional circumstances")):
            flags.append("Authorised under exceptional circumstances (EU).")
        if _yes(r.get("Additional monitoring")):
            flags.append("Under additional monitoring in the EU (black triangle).")
        if not indication:
            flags.append("No therapeutic indication text in the EMA file.")
        kind = "Generic" if _yes(r.get("Generic")) else "Biosimilar" if _yes(r.get("Biosimilar")) else (
            "Advanced therapy" if _yes(r.get("Advanced therapy")) else "EU centralised")
        row = {
            "regulator": "EMA",
            "application_number": number,
            "application_type": kind,
            "drug_name": name,
            "brand_name": name,
            "generic_name": inn,
            "active_ingredient": _clean(r.get("Active substance")) or inn,
            "manufacturer": _clean(r.get("Marketing authorisation developer / applicant / holder")),
            "dosage_form": None,
            "strength": None,
            "route": None,
            "indication": indication[:4000] if indication else None,
            "pharm_class": [x for x in [_clean(r.get("Pharmacotherapeutic group (human)")), _clean(r.get("ATC code (human)"))] if x],
            "fda_status": "Authorised",
            "approval_date": _d(r.get("Marketing authorisation date")),
            "latest_action_date": _d(r.get("Last updated date")) or _d(r.get("European Commission decision date")),
            "marketing_status": "EU marketing authorisation (centralised)" + (" — conditional" if _yes(r.get("Conditional approval")) else ""),
            "label_set_id": None,
            "label_effective_date": None,
            "fda_source": EMA_SOURCE,
            "fda_source_url": EMA_PAGE_URL,
            "drugs_at_fda_url": _clean(r.get("Medicine URL")),
            "label_url": (_clean(r.get("Medicine URL")) + "#product-info") if _clean(r.get("Medicine URL")) else None,
            "review_flags": flags,
            "orphan": _yes(r.get("Orphan medicine")),
        }
        rows.append(_finish(row, indication))
    wb.close()
    if header is None:
        raise ValueError("The EMA file layout was not recognised (no 'Category' header row).")
    return rows, skipped


# ------------------------------------------------------------------ PMDA
_TAG_RE = re.compile(r"[\[<]\s*(Orphan drug|Priority review|Priority Review|SAKIGAKE[^\]>]*|Conditional[^\]>]*|"
                     r"Notification of off-label use|Pediatric[^\]>]*|Regenerative[^\]>]*)\s*[\]>]", re.I)


def _dedouble(s: str) -> str:
    """'((TTaakkeeddaa' -> '(Takeda' (bold text extracted twice)."""
    def fix(m: re.Match) -> str:
        t = m.group(0)
        return t[::2] if len(t) % 2 == 0 and all(t[i] == t[i + 1] for i in range(0, len(t), 2)) else t
    return re.sub(r"\S{4,}", fix, s)


def _split_brand(cell: str, numbered: bool) -> tuple[str | None, str | None, str | None]:
    """'48\\nEmtriva Capsules 200mg\\n(Japan Tobacco Inc.)' -> (no, brand, company)."""
    text = _dedouble(cell or "").strip()
    no = None
    if numbered:
        m = re.match(r"^(\d{1,4})\s*\n?\s*(.*)$", text, re.S)
        if m:
            no, text = m.group(1), m.group(2)
    company = None
    m = re.search(r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$", text, re.S)
    if m:
        company = _clean(m.group(1))
        text = text[:m.start()]
    brands = [b.strip() for b in text.split("\n") if b.strip()]
    brand = re.sub(r"\s+", " ", " ".join(brands)).strip() if brands else None
    return no, brand or None, company


def pmda_page_count(pdf_bytes: bytes) -> int:
    import pypdfium2 as pdfium
    return len(pdfium.PdfDocument(pdf_bytes))


def pmda_rows(pdf_bytes: bytes, start: int, end: int) -> tuple[list[dict], list[dict]]:
    """Rows whose table row starts on pages [start, end) (0-based). Page start-1 is read too,
    so a row split across the chunk boundary is completed and written again (same key)."""
    import pdfplumber

    raw: list[tuple[int, list[str | None]]] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        first = max(2, start - 1)
        for i in range(first, min(end, len(pdf.pages))):
            for table in pdf.pages[i].extract_tables():
                for r in table:
                    if not r or (r[0] or "").replace("\n", " ").strip().startswith(("Category", "Review Category", "Review")) and (r[1] or "").startswith(("Date", "Approval")):
                        continue
                    raw.append((i, r))

    merged: list[dict] = []
    last_category = None
    for page, r in raw:
        if len(r) == 6:  # older layout: number glued to the brand name
            r = [r[0], r[1], None, r[2], r[3], r[4], r[5]]
        if len(r) < 7:
            continue
        category, when, no_cell, brand_cell, kind, ingredients, note = r[:7]
        if not when:  # continuation of the previous row (cell text split by a page or table break)
            if merged:
                prev = merged[-1]
                for key, val in (("brand_cell", brand_cell), ("ingredients", ingredients), ("note", note)):
                    if val:
                        prev[key] = (prev[key] or "") + "\n" + val
                prev["continued"] = True
            continue
        category = _clean(category) or last_category
        last_category = category
        merged.append({"page": page, "category": category, "when": when, "no": _clean(no_cell), "brand_cell": brand_cell or "",
                       "kind": kind or "", "ingredients": ingredients or "", "note": note or "", "numbered": no_cell is None})

    rows: list[dict] = []
    problems: list[dict] = []
    before = [i for i, m in enumerate(merged) if m["page"] < start]
    carry = before[-1] if before else None
    for i, m in enumerate(merged):
        if m["page"] < start and not (i == carry and m.get("continued")):
            continue
        approved = _d(m["when"])
        no, brand, company = _split_brand(m["brand_cell"], m["numbered"])
        no = m["no"] or no
        ingredients = _clean(_dedouble(m["ingredients"]).replace("-\n", "").replace("\n", " "))
        note = re.sub(r"\s+", " ", _dedouble(m["note"]).replace("-\n", "")).strip()
        tags = [t.group(1).strip() for t in _TAG_RE.finditer(note)]
        indication = _clean(_TAG_RE.sub(" ", note))
        if not approved or not brand:
            problems.append({"name": brand or ingredients or "?", "error": f"Could not read the approval date or brand name (page {m['page'] + 1})"})
            continue
        change = "change" in m["kind"].lower() or "partial" in m["kind"].lower()
        key = re.sub(r"[^A-Za-z0-9]+", "", (brand or "")[:40]).upper()
        number = f"PMDA-{approved.replace('-', '')}-{no or 'X'}-{key[:24]}"
        category = (m["category"] or "").replace("\n", " ")
        flags = ["Partial change approval: a new indication, dosage or formulation for an already approved product."] if change else []
        if any("off-label" in t.lower() for t in tags):
            flags.append("Approved after a notification of off-label use.")
        row = {
            "regulator": "PMDA",
            "application_number": number,
            "application_type": "Partial change" if change else "New approval",
            "drug_name": brand,
            "brand_name": brand,
            "generic_name": ingredients,
            "active_ingredient": ingredients,
            "manufacturer": company,
            "dosage_form": None,
            "strength": None,
            "route": None,
            "indication": indication,
            "pharm_class": [f"PMDA review category: {category}"] if category else [],
            "fda_status": "Approved (partial change)" if change else "Approved",
            "approval_date": approved,
            "latest_action_date": approved,
            "marketing_status": "; ".join(tags) or None,
            "label_set_id": None,
            "label_effective_date": None,
            "fda_source": PMDA_SOURCE,
            "fda_source_url": PMDA_PAGE_URL,
            "drugs_at_fda_url": PMDA_PAGE_URL,
            "label_url": PMDA_REPORTS_URL,
            "review_flags": flags,
            "orphan": any(t.lower().startswith("orphan") for t in tags),
        }
        rows.append(_finish(row, indication))
    # The same product can appear twice on one day (several strengths): keep one row per key.
    unique: dict[str, dict] = {}
    for r in rows:
        unique.setdefault(r["application_number"], r)
    return list(unique.values()), problems
