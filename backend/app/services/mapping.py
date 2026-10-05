"""Mapping engine: Google Sheet rows -> normalised records.

Pure functions only (no network, no database) so the same code is used by the
live sync service, the initial loader and the tests.

A tab's behaviour is described by its ``mapping`` JSON (stored on
``google_sheet_tabs.mapping``). Every key is optional; columns that are not
recognised are kept in ``extra`` and nothing from the sheet is ever dropped.
See GOOGLE_SHEETS.md for the full format.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))

# Normalised doctor field -> header names seen in the Ikris sheets (lower case).
HEADER_SYNONYMS: dict[str, list[str]] = {
    "s_no": ["s.no", "s.no.", "s no", "sno", "sr no", "sr. no", "serial no"],
    "bdm": ["bdm"],
    "nsm": ["nsm"],
    "doctor_name": ["doctor name", "doctor's name", "doctors name", "doctor", "name of doctor"],
    "qualification": ["qualification", "degree"],
    "specialty": ["specialty", "speciality", "specialization", "specialisation"],
    "category": ["category", "category (a/b/c)", "category a/b/c"],
    "institute": ["institute", "hospital", "hospital name", "institution", "clinic"],
    "institute_address": ["institute address", "address", "hospital address"],
    "city": ["city"],
    "state": ["state"],
    "country": ["country"],
    "contact_number": [
        "contact number", "contact no", "contact", "phone", "phone number", "mobile",
        "mobile number", "doctors contact details", "doctor's contact details", "contact details",
    ],
    "whatsapp_number": ["whatsapp", "whatsapp number", "whatsapp no"],
    "email": ["email", "email id", "e-mail", "email address", "doctors email id", "doctor's email id"],
    "date_of_birth": ["date of birth", "dob", "birthday"],
    "date_of_anniversary": ["date of anniversary", "anniversary", "anniversary date"],
}

DOCTOR_FIELDS = list(HEADER_SYNONYMS.keys())

FEEDBACK_SYNONYMS: dict[str, list[str]] = {
    "request_date": ["date", "request date"],
    "patient_id": ["patient id"],
    "patient_name": ["patient name", "patient"],
    "country_code": ["country code"],
    "phone_number": ["phone number", "phone", "mobile", "contact number"],
    "medicine": ["medicine", "medicine name", "product"],
    "doctor_name": ["doctor", "doctor name", "doctors name"],
    "hospital": ["hospital", "hospital name"],
    "disease": ["disease"],
    "feedback": ["feedback", "comments"],
    "rating": ["rating"],
    "review_link": ["google review link", "review link"],
    "whatsapp_status": ["whatsapp status", "status"],
    "sent_date": ["sent date"],
    "division": ["division", "department"],
}

DEFAULT_DATE_FORMATS = ["%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%Y-%m-%d"]
EMAIL_RE = re.compile(r"^[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}$")
TEST_NAMES = {"test", "testing", "demo"}


def norm_header(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def build_headers(header_row: list[Any], width: int) -> list[str]:
    """Header names for each column; blank headers become 'Column G' etc."""
    headers: list[str] = []
    seen: dict[str, int] = {}
    for i in range(width):
        raw = str(header_row[i]).strip() if i < len(header_row) else ""
        name = raw or f"Column {column_letter(i)}"
        if name in seen:
            seen[name] += 1
            name = f"{name} ({seen[name]})"
        else:
            seen[name] = 1
        headers.append(name)
    return headers


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\r", " ").strip()
    text = re.sub(r"[ \t]*\n[ \t]*", ", ", text)
    return text or None


def norm_text(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"\s+", " ", value).strip().lower() or None


def norm_name(value: str | None) -> str | None:
    if not value:
        return None
    text = value.lower()
    text = re.sub(r"^\s*(dr\.?|doctor)\s*", "", text)
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip() or None


def norm_email(value: str | None) -> tuple[str | None, str | None]:
    """Returns (normalised email, issue code). A cell holding several
    addresses ("a@x.com, b@y.com" or "a@x.com/b@y.com") uses the first
    valid one."""
    if not value:
        return None, None
    text = value.strip().lower().rstrip(",;. ")
    if EMAIL_RE.match(text):
        return text, None
    parts = [p.strip().rstrip(".") for p in re.split(r"[,;/]+", text) if p.strip()]
    if len(parts) > 1:
        valid = [p for p in parts if EMAIL_RE.match(p)]
        if valid:
            return valid[0], "email_multiple"
    return None, "email_invalid"


def norm_phone(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    if re.search(r"\d[.,]?\d*e\+\d+", value.lower()):
        # The sheet stored this number in scientific notation; digits are lost.
        return None, "phone_lost_in_sheet"
    digits = re.sub(r"\D", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        return digits, None
    if 10 <= len(digits) <= 15 and not (len(digits) == 11 and digits[0] in "6789"):
        return digits, None  # landline / international, kept as digits
    return None, "phone_invalid"


def parse_date(value: str | None, formats: list[str]) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    # Hand-typed dates: "10 - Aug", "11- Aug", "1st May", "17-July"
    text = re.sub(r"\s*([-/.])\s*", r"\1", text)
    text = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", text, flags=re.I)
    text = re.sub(r"\s+", " ", text)
    for fmt in formats:
        try:
            if "%Y" not in fmt:
                parsed = datetime.strptime(f"{text} 1904", f"{fmt} %Y")
            else:
                parsed = datetime.strptime(text, fmt)
            return parsed.replace(tzinfo=IST)
        except ValueError:
            continue
    return None


def _person_date_formats(tab_formats: list[str]) -> list[str]:
    """Birthdays are usually typed by hand: tab formats first, then day-first
    and written-month forms. Year-less values (e.g. "15-Aug") get year 1904."""
    extra = DEFAULT_DATE_FORMATS + [
        "%d-%b-%Y", "%d %B %Y", "%d %b %Y", "%d-%B-%Y", "%d.%m.%Y",
        "%d-%b", "%d-%B", "%d %B", "%d %b", "%b-%d", "%B %d", "%b %d",
    ]
    out: list[str] = []
    for f in tab_formats + extra:
        if f not in out:
            out.append(f)
    return out


def record_hash(data: dict[str, Any]) -> str:
    payload = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolve_columns(headers: list[str], synonyms: dict[str, list[str]], overrides: dict[str, Any]) -> dict[str, str]:
    """field -> exact header name present in this sheet."""
    lookup = {norm_header(h): h for h in headers}
    resolved: dict[str, str] = {}
    for fld, names in synonyms.items():
        override = overrides.get(fld)
        if override is False:
            continue  # explicitly unmapped
        candidates = [override] if isinstance(override, str) else []
        candidates += names
        for cand in candidates:
            header = lookup.get(norm_header(cand))
            if header and header not in resolved.values():
                resolved[fld] = header
                break
    return resolved


def detect_kind(headers: list[str]) -> str:
    """Guess whether an unknown tab holds doctors, feedback or nothing useful."""
    doc = _resolve_columns(headers, HEADER_SYNONYMS, {})
    fb = _resolve_columns(headers, FEEDBACK_SYNONYMS, {})
    if "patient_name" in fb:
        return "feedback"
    if "doctor_name" in doc and ({"email", "contact_number", "institute", "specialty"} & doc.keys()):
        return "doctors"
    return "ignore"


@dataclass
class TabContext:
    spreadsheet_id: str
    sheet_name: str
    department: str | None
    sub_department: str | None
    specialty: str | None
    mapping: dict[str, Any]
    header_row: int = 1


@dataclass
class DoctorRow:
    row_number: int
    raw: dict[str, str | None]
    fields: dict[str, Any]
    department: str
    dedupe_key: str
    issues: list[str]
    events: list[dict[str, Any]]
    row_hash: str
    row_key: str


@dataclass
class FeedbackRow:
    row_number: int
    raw: dict[str, str | None]
    fields: dict[str, Any]
    issues: list[str]
    row_hash: str
    source_key: str


@dataclass
class TabResult:
    headers: list[str]
    doctors: list[DoctorRow] = field(default_factory=list)
    feedback: list[FeedbackRow] = field(default_factory=list)
    skipped_blank: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)


def _rows_with_headers(values: list[list[Any]], header_row: int) -> tuple[list[str], list[tuple[int, dict[str, str | None]]]]:
    if len(values) < header_row:
        return [], []
    width = max((len(r) for r in values), default=0)
    headers = build_headers(values[header_row - 1], width)
    rows = []
    for offset, row in enumerate(values[header_row:], start=header_row + 1):
        raw = {h: clean(row[i]) if i < len(row) else None for i, h in enumerate(headers)}
        rows.append((offset, raw))
    return headers, rows


def _value_map(rule: dict[str, Any] | None, raw: dict[str, str | None], default: str | None) -> str | None:
    if not rule:
        return default
    if "value" in rule:
        return rule["value"]
    column = rule.get("column")
    value = raw.get(column) if column else None
    if value is None:
        return rule.get("default", default)
    mapping = {str(k).strip().lower(): v for k, v in (rule.get("map") or {}).items()}
    if mapping:
        return mapping.get(value.strip().lower(), rule.get("default", value))
    return value


def _event_status(value: str | None, rule: dict[str, Any], error: str | None) -> str | None:
    text = (value or "").strip().lower()
    if not text:
        return None
    if rule.get("skipped_pattern") and error and re.search(rule["skipped_pattern"], error, re.I):
        return "Not sent"
    if re.search(rule.get("failed_pattern", r"error|fail|^no$|invalid|bounce"), text, re.I):
        return "Failed"
    if re.search(rule.get("sent_pattern", r"^(sent|yes|delivered|done)"), text, re.I):
        return "Sent"
    if text in {"duplicate"}:
        return "Duplicate"
    return value.strip()


def map_doctor_tab(ctx: TabContext, values: list[list[Any]]) -> TabResult:
    headers, rows = _rows_with_headers(values, ctx.header_row)
    result = TabResult(headers=headers)
    if not headers:
        return result
    mapping = ctx.mapping or {}
    columns = _resolve_columns(headers, HEADER_SYNONYMS, mapping.get("fields", {}))
    used_headers = set(columns.values())
    formats = mapping.get("date_formats") or DEFAULT_DATE_FORMATS
    event_rules: list[dict[str, Any]] = mapping.get("events", [])
    for rule in event_rules:
        for key in ("status_column", "date_column", "subject_column", "error_column", "detail_column"):
            if rule.get(key):
                used_headers.add(rule[key])
    if mapping.get("sub_department", {}).get("column"):
        used_headers.add(mapping["sub_department"]["column"])

    for row_number, raw in rows:
        if not any(raw.values()):
            result.skipped_blank += 1
            continue
        fields: dict[str, Any] = {f: raw.get(h) for f, h in columns.items()}
        if not fields.get("doctor_name"):
            result.errors.append({"row": row_number, "error": "Doctor name is empty"})
            continue
        issues: list[str] = []

        email_norm, issue = norm_email(fields.get("email"))
        if issue:
            issues.append(issue)
        # WhatsApp-only sheets: use the WhatsApp number to identify the doctor
        phone_norm, issue = norm_phone(fields.get("contact_number") or fields.get("whatsapp_number"))
        if issue:
            issues.append(issue)
        wa_norm, _ = norm_phone(fields.get("whatsapp_number"))

        category = (fields.get("category") or "").strip().upper()
        category = category[-1] if category and category[-1] in "ABC" and len(category) <= 12 else None

        for date_field in ("date_of_birth", "date_of_anniversary"):
            if fields.get(date_field):
                parsed = parse_date(fields[date_field], _person_date_formats(formats))
                if parsed is None:
                    issues.append(f"{date_field}_invalid")
                    fields[date_field] = None
                else:
                    fields[date_field] = parsed.date().isoformat()

        name_norm = norm_name(fields["doctor_name"])
        if name_norm in TEST_NAMES:
            issues.append("looks_like_test_record")
        institute_norm = norm_text(fields.get("institute")) or ""
        if email_norm:
            dedupe_key = f"e:{email_norm}"
        elif phone_norm:
            dedupe_key = f"p:{phone_norm}"
        else:
            dedupe_key = f"n:{name_norm}|{institute_norm}"

        department = _value_map(mapping.get("department"), raw, ctx.department)
        if department not in ("NPP", "RARE_DISEASES"):
            result.errors.append({"row": row_number, "error": f"Unknown department '{department}'"})
            continue
        sub_department = _value_map(mapping.get("sub_department"), raw, ctx.sub_department)

        extra = {h: v for h, v in raw.items() if h not in used_headers and v is not None}
        record = {
            **{f: fields.get(f) for f in DOCTOR_FIELDS},
            "category": category,
            "specialty": fields.get("specialty") or ctx.specialty,
            "sub_department": sub_department,
            "email_norm": email_norm,
            "phone_norm": phone_norm,
            "whatsapp_number": fields.get("whatsapp_number"),
            "name_norm": name_norm,
            "city_norm": norm_text(fields.get("city")),
            "extra": extra,
        }
        if fields.get("whatsapp_number") and not wa_norm:
            issues.append("whatsapp_invalid")

        events = []
        for rule in event_rules:
            error = raw.get(rule.get("error_column", "")) if rule.get("error_column") else None
            if rule.get("status_from_date"):
                # "Sent On" style columns: a date means it was sent that day
                status = "Sent" if raw.get(rule.get("date_column", "")) else None
            else:
                status = _event_status(raw.get(rule.get("status_column", "")), rule, error)
            if status is None:
                continue
            occurred = parse_date(raw.get(rule.get("date_column", "")), formats) if rule.get("date_column") else None
            campaign = rule.get("campaign") or rule.get("event_type")
            if rule.get("campaign_column") and raw.get(rule["campaign_column"]):
                campaign = f"{campaign} {raw[rule['campaign_column']]}"
            detail_parts = []
            if rule.get("detail_column") and raw.get(rule["detail_column"]):
                detail_parts.append(f"{rule['detail_column']}: {raw[rule['detail_column']]}")
            if error and status != "Sent":
                detail_parts.append(error)
            event = {
                "channel": rule.get("channel", "EMAIL"),
                "direction": "OUTBOUND",
                "event_type": rule.get("event_type", "Email"),
                "status": status,
                "subject": raw.get(rule["subject_column"]) if rule.get("subject_column") and status == "Sent" else None,
                "detail": " | ".join(detail_parts) or None,
                "campaign": campaign,
                "occurred_at": occurred.isoformat() if occurred else None,
            }
            event["external_key"] = record_hash({
                "s": ctx.spreadsheet_id, "t": ctx.sheet_name, "k": dedupe_key, "r": rule.get("event_type"),
                "d": event["occurred_at"], "c": campaign, "x": event["detail"], "st": status,
            })[:24]
            events.append(event)

        result.doctors.append(DoctorRow(
            row_number=row_number,
            raw=raw,
            fields=record,
            department=department,
            dedupe_key=dedupe_key,
            issues=issues,
            events=events,
            row_hash=record_hash(raw),
            row_key=record_hash({"k": dedupe_key, "raw": raw})[:24],
        ))
    return result


def map_feedback_tab(ctx: TabContext, values: list[list[Any]]) -> TabResult:
    headers, rows = _rows_with_headers(values, ctx.header_row)
    result = TabResult(headers=headers)
    if not headers:
        return result
    mapping = ctx.mapping or {}
    columns = _resolve_columns(headers, FEEDBACK_SYNONYMS, mapping.get("fields", {}))
    formats = mapping.get("date_formats") or DEFAULT_DATE_FORMATS
    division_map = {k.lower(): v for k, v in (mapping.get("division_department") or {}).items()}

    for row_number, raw in rows:
        if not any(raw.values()):
            result.skipped_blank += 1
            continue
        f: dict[str, Any] = {k: raw.get(h) for k, h in columns.items()}
        if not f.get("patient_name") and not f.get("phone_number"):
            result.errors.append({"row": row_number, "error": "Patient name and phone are empty"})
            continue
        issues: list[str] = []
        department = division_map.get((f.get("division") or "").strip().lower(), ctx.department)
        if department not in ("NPP", "RARE_DISEASES"):
            result.errors.append({"row": row_number, "error": f"Unknown division '{f.get('division')}'"})
            continue
        for date_field in ("request_date", "sent_date"):
            if f.get(date_field):
                parsed = parse_date(f[date_field], formats)
                if parsed is None:
                    issues.append(f"{date_field}_invalid")
                    f[date_field] = None
                else:
                    f[date_field] = parsed.date().isoformat()
        phone, issue = norm_phone(f.get("phone_number"))
        if issue:
            issues.append(issue)
        rating = None
        if f.get("rating"):
            try:
                rating = max(1, min(5, int(float(f["rating"]))))
            except ValueError:
                issues.append("rating_invalid")
        status = (f.get("whatsapp_status") or "").strip()
        record = {
            "department": department,
            "division": f.get("division"),
            "patient_id": f.get("patient_id"),
            "patient_name": f.get("patient_name"),
            "country_code": f.get("country_code"),
            "phone_number": phone or f.get("phone_number"),
            "medicine": f.get("medicine"),
            "doctor_name": f.get("doctor_name"),
            "hospital": f.get("hospital"),
            "disease": f.get("disease"),
            "feedback": f.get("feedback"),
            "rating": rating,
            "request_date": f.get("request_date"),
            "sent_date": f.get("sent_date"),
            "whatsapp_status": status or None,
            "review_link": f.get("review_link"),
            "status": "Review requested" if status.lower() == "sent" else (status or "Pending"),
        }
        source_key = record_hash({"s": ctx.spreadsheet_id, "t": ctx.sheet_name, "raw": raw})[:24]
        result.feedback.append(FeedbackRow(
            row_number=row_number, raw=raw, fields=record, issues=issues,
            row_hash=record_hash(raw), source_key=source_key,
        ))
    return result


@dataclass
class MergedDoctor:
    department: str
    dedupe_key: str
    fields: dict[str, Any]
    issues: list[str]
    rows: list[tuple[TabContext, DoctorRow]]
    record_hash: str


def merge_doctors(tab_results: list[tuple[TabContext, TabResult]]) -> tuple[list[MergedDoctor], int]:
    """Combine rows that describe the same doctor (same department + identity).

    The first non-empty value wins for each field; every source row is kept for
    traceability. Returns (merged doctors, number of duplicate rows folded in).
    """
    merged: dict[tuple[str, str], MergedDoctor] = {}
    duplicates = 0
    for ctx, result in tab_results:
        for row in result.doctors:
            key = (row.department, row.dedupe_key)
            if key not in merged:
                merged[key] = MergedDoctor(
                    department=row.department, dedupe_key=row.dedupe_key,
                    fields=dict(row.fields), issues=list(row.issues), rows=[(ctx, row)], record_hash="",
                )
                continue
            duplicates += 1
            doc = merged[key]
            doc.rows.append((ctx, row))
            for k, v in row.fields.items():
                if k == "extra":
                    for ek, ev in (v or {}).items():
                        doc.fields["extra"].setdefault(ek, ev)
                elif doc.fields.get(k) in (None, "") and v not in (None, ""):
                    doc.fields[k] = v
            for issue in row.issues:
                if issue not in doc.issues:
                    doc.issues.append(issue)

    # Same name + institute under different identities -> likely duplicate person.
    by_name: dict[tuple[str, str, str], list[MergedDoctor]] = {}
    for doc in merged.values():
        name = doc.fields.get("name_norm") or ""
        inst = (norm_text(doc.fields.get("institute")) or "").split(" ")[0]
        if name and name not in TEST_NAMES:
            by_name.setdefault((doc.department, name, inst), []).append(doc)
    for group in by_name.values():
        if len(group) > 1:
            for doc in group:
                if "possible_duplicate" not in doc.issues:
                    doc.issues.append("possible_duplicate")

    for doc in merged.values():
        doc.record_hash = record_hash({"f": doc.fields, "i": sorted(doc.issues)})
    return list(merged.values()), duplicates


# --------------------------------------------------------------------------- templates

def a1_to_index(ref: str) -> tuple[int, int]:
    """'B2' -> (row 1, col 1), 0-based."""
    m = re.fullmatch(r"([A-Za-z]+)(\d+)", ref.strip())
    if not m:
        raise ValueError(f"Bad cell reference: {ref}")
    col = 0
    for ch in m.group(1).upper():
        col = col * 26 + (ord(ch) - 64)
    return int(m.group(2)) - 1, col - 1


def _cell(values: list[list[Any]], ref: str) -> str | None:
    r, c = a1_to_index(ref)
    if r < len(values) and c < len(values[r]):
        v = values[r][c]
        return None if v is None or str(v) == "" else str(v)
    return None


def _left_label(values: list[list[Any]], ref: str) -> str | None:
    r, c = a1_to_index(ref)
    if c == 0:
        return None
    return _cell(values, f"{column_letter(c - 1)}{r + 1}")


def map_template_tab(ctx: TabContext, values: list[list[Any]]) -> list[dict[str, Any]]:
    """Read email templates from a tab. Text is kept exactly as written
    (HTML, line breaks and leading spaces matter to the automation)."""
    m = ctx.mapping or {}
    layout = m.get("layout")
    out: list[dict[str, Any]] = []
    if layout == "cells":
        notes = []
        for ref in m.get("notes_cells", []):
            value = _cell(values, ref)
            if value:
                label = _left_label(values, ref)
                notes.append(f"{label}: {value}" if label else value)
        out.append({
            "source_ref": "cells", "kind": "email", "name": ctx.sheet_name,
            "subject": _cell(values, m["subject_cell"]), "body_html": _cell(values, m["body_cell"]),
            "subject_cell": m["subject_cell"], "body_cell": m["body_cell"], "active_cell": None,
            "is_active": None, "campaign": None, "specialty": None,
            "notes": "\n".join(notes) or None, "sort_order": 0,
        })
    elif layout == "rows":
        if not values:
            return out
        header = [norm_header(str(h)) for h in values[0]]
        cols = {}
        for key, name in (m.get("columns") or {}).items():
            if norm_header(name) in header:
                cols[key] = header.index(norm_header(name))
        def get(row: list[Any], key: str) -> str | None:
            i = cols.get(key)
            if i is None or i >= len(row) or row[i] in (None, ""):
                return None
            return str(row[i])
        def ref(key: str, row_no: int) -> str | None:
            return f"{column_letter(cols[key])}{row_no}" if key in cols else None
        for offset, row in enumerate(values[1:], start=2):
            if not any(str(v).strip() for v in row):
                continue
            campaign, specialty = get(row, "campaign"), get(row, "specialty")
            active = get(row, "active")
            out.append({
                "source_ref": f"row:{offset}", "kind": "campaign",
                "name": " · ".join(p for p in (campaign, specialty) if p) or f"Row {offset}",
                "campaign": campaign, "specialty": specialty,
                "subject": get(row, "subject"), "body_html": get(row, "body"),
                "subject_cell": ref("subject", offset), "body_cell": ref("body", offset),
                "active_cell": ref("active", offset),
                "is_active": (active or "").strip().lower() in ("yes", "y", "true", "active", "1") if "active" in cols else None,
                "notes": None, "sort_order": offset,
            })
    elif layout == "subject_list":
        col = m.get("column", "A")
        _, c = a1_to_index(f"{col}1")
        start = int(m.get("start_row", 2))
        info = []
        for label, cell_ref in (m.get("info_cells") or {}).items():
            value = _cell(values, cell_ref)
            if value is not None:
                info.append(f"{label}: {value}")
        n = 0
        for r in range(start - 1, len(values)):
            row = values[r]
            value = str(row[c]) if c < len(row) and row[c] not in (None, "") else ""
            if not value.strip():
                continue
            n += 1
            out.append({
                "source_ref": f"row:{r + 1}", "kind": "subject_line", "name": f"Subject line {n}",
                "subject": value, "body_html": None, "subject_cell": f"{col}{r + 1}", "body_cell": None,
                "active_cell": None, "is_active": None, "campaign": None, "specialty": None,
                "notes": "\n".join(info) or None, "sort_order": r + 1,
            })
    else:
        raise ValueError(f"Unknown template layout '{layout}'")
    return out
