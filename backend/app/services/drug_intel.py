"""International Drug Intelligence: source parsers, name normalisation and rules.

Sources (checked for access and terms before use)
- USA: openFDA Drugs@FDA bulk export (public domain, US Government data).
  https://open.fda.gov/data/downloads/ — NDA and BLA applications with an approved
  original submission. Over-the-counter-only and tentative approvals are skipped.
- EU: EMA "Medicines" data file (updated nightly). EMA allows commercial reuse
  provided EMA is acknowledged as the source; every EU record carries that credit.
  https://www.ema.europa.eu/en/medicines/download-medicine-data
- Japan, UK and national EU registers: admin-verified CSV import (no unrestricted
  automated access is assumed).
- KEGG: non-academic use needs a commercial licence, so KEGG data is not imported.
  A KEGG ID can be entered by hand or by CSV once Ikris holds a licence.

Nothing here invents values: a field the source does not state stays empty, and a
jurisdiction without a record is shown as "Not Verified" (never as "not approved").
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Iterable

from . import drug_classifier

STATUSES = ("Approved", "Under Review", "Withdrawn", "Suspended", "Refused", "Expired",
            "Not Verified", "No Approval Record Found")
STATUS_PRIORITY = {s: i for i, s in enumerate(
    ("Approved", "Suspended", "Under Review", "Expired", "Withdrawn", "Refused", "No Approval Record Found", "Not Verified"))}

EMA_CREDIT = "Source: European Medicines Agency (EMA), medicine data download"
EMA_FILE_URL = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx"
EMA_PAGE_URL = "https://www.ema.europa.eu/en/medicines/download-medicine-data"
FDA_DOWNLOAD_INDEX = "https://api.fda.gov/download.json"
FDA_APP_URL = "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={}"

# Matrix shown on every drug page; more countries can be added through CSV/manual entry.
MATRIX = ("US", "EU", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "BG", "JP")
COUNTRIES: dict[str, tuple[str, str, str]] = {  # code -> (name, region, authority)
    "US": ("USA", "USA", "FDA"),
    "EU": ("European Union (centralised)", "Europe", "EMA / European Commission"),
    "GB": ("United Kingdom", "Europe", "MHRA"),
    "DE": ("Germany", "Europe", "BfArM / PEI"),
    "FR": ("France", "Europe", "ANSM"),
    "IT": ("Italy", "Europe", "AIFA"),
    "ES": ("Spain", "Europe", "AEMPS"),
    "NL": ("Netherlands", "Europe", "CBG-MEB"),
    "BE": ("Belgium", "Europe", "FAMHP"),
    "BG": ("Bulgaria", "Europe", "BDA"),
    "JP": ("Japan", "Japan", "PMDA / MHLW"),
    "AT": ("Austria", "Europe", "BASG"),
    "CH": ("Switzerland", "Europe", "Swissmedic"),
    "IE": ("Ireland", "Europe", "HPRA"),
    "PT": ("Portugal", "Europe", "INFARMED"),
    "PL": ("Poland", "Europe", "URPL"),
    "SE": ("Sweden", "Europe", "MPA"),
    "DK": ("Denmark", "Europe", "DKMA"),
    "FI": ("Finland", "Europe", "Fimea"),
    "NO": ("Norway", "Europe", "NOMA"),
    "GR": ("Greece", "Europe", "EOF"),
    "CZ": ("Czechia", "Europe", "SUKL"),
    "HU": ("Hungary", "Europe", "OGYEI"),
    "RO": ("Romania", "Europe", "ANMDMR"),
}
_NAME_TO_CODE = {v[0].lower(): k for k, v in COUNTRIES.items()} | {
    "usa": "US", "united states": "US", "us": "US", "eu": "EU", "europe": "EU", "european union": "EU",
    "uk": "GB", "great britain": "GB", "england": "GB", "japan": "JP", "the netherlands": "NL", "holland": "NL",
}


def country_code(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip()
    if re.fullmatch(r"[A-Za-z]{2}", v) and v.upper() in COUNTRIES:
        return v.upper()
    return _NAME_TO_CODE.get(v.lower())


def country_meta(code: str) -> tuple[str, str, str]:
    return COUNTRIES.get(code, (code, "Other", ""))


# ------------------------------------------------------------------ names
_SALTS = {
    "hydrochloride", "hcl", "dihydrochloride", "hydrobromide", "mesylate", "mesilate", "dimesylate", "besylate",
    "besilate", "maleate", "fumarate", "hemifumarate", "succinate", "tartrate", "bitartrate", "citrate", "sulfate",
    "sulphate", "bisulfate", "phosphate", "diphosphate", "acetate", "sodium", "disodium", "potassium", "calcium",
    "magnesium", "tosylate", "tosilate", "lactate", "malate", "nitrate", "bromide", "chloride", "iodide",
    "monohydrate", "dihydrate", "trihydrate", "hemihydrate", "sesquihydrate", "hydrate", "anhydrous", "meglumine",
    "trometamol", "tromethamine", "hyclate", "edisylate", "esylate", "napsylate", "oxalate", "pamoate", "embonate",
    "monosodium", "dipotassium", "hemisulfate", "mononitrate", "monohydrochloride", "dimaleate", "olamine",
    "dichloride", "trihydrochloride", "dihydrobromide", "hemitartrate", "hemioxalate", "benzoate",
}
# US adopted names (USAN) that differ from the INN used by EMA and PMDA.
_ALIASES = {
    "hydroxyurea": "hydroxycarbamide", "dalfampridine": "fampridine", "acetaminophen": "paracetamol",
    "albuterol": "salbutamol", "levalbuterol": "levosalbutamol", "cyclosporine": "ciclosporin",
    "glyburide": "glibenclamide", "meperidine": "pethidine", "furosemide": "furosemide",
    "busulfan": "busulfan", "mesna": "mesna", "sulfasalazine": "sulfasalazine", "rifampin": "rifampicin",
    "ethacrynic acid": "etacrynic acid", "epinephrine": "adrenaline", "norepinephrine": "noradrenaline",
    "sodium cromoglycate": "cromoglicic acid", "cromolyn": "cromoglicic acid", "pegvaliase": "pegvaliase",
    "tretinoin": "tretinoin", "mitoxantrone": "mitoxantrone", "leucovorin": "folinic acid",
    "levoleucovorin": "levofolinic acid", "estradiol": "estradiol", "torsemide": "torasemide",
}
_SPLIT = re.compile(r"\s*(?:;|/|\+|,|\band\b)\s*", re.I)


def _clean_component(c: str) -> str:
    c = re.sub(r"\[.*?\]|\(.*?\)", " ", c.lower())
    c = re.sub(r"[^a-z0-9\- ]+", " ", c)
    c = re.sub(r"(?<=[a-z])-(?=\d)", "", c)  # ra-223 -> ra223
    words = c.split()
    if words and words[0] in ("fam-" , "ado-"):
        words = words[1:]
    words = [re.sub(r"^(?:fam|ado)-(?=[a-z]{6,})", "", w) for w in words]
    while len(words) > 1 and words[-1] in _SALTS and words[-2] not in _SALTS:
        words.pop()
    # FDA biologic 4-letter suffixes (trastuzumab-dkst, enfortumab vedotin-ejfv) name the same substance.
    if words:
        words[-1] = re.sub(r"^([a-z]{5,})-[a-z]{4}$", r"\1", words[-1])
    c = " ".join(words).strip()
    return _ALIASES.get(c, c)


def ingredients(name: str | None) -> list[str]:
    if not name:
        return []
    text = re.sub(r"\(.*?\)", " ", name)
    parts = [_clean_component(p) for p in _SPLIT.split(text)]
    return sorted({p for p in parts if p})


def match_key(name: str | None) -> str:
    """Normalised identity of an active substance (or combination) used for de-duplication."""
    return " + ".join(ingredients(name))


def display_name(name: str) -> str:
    name = re.sub(r"\s*;\s*", " / ", re.sub(r"\s+", " ", name.strip()))
    return name if any(ch.islower() for ch in name) else name.lower()


# ------------------------------------------------------------------ therapeutic areas
ATC_GROUPS = {
    "A": "Alimentary tract & metabolism", "B": "Blood & blood-forming organs", "C": "Cardiovascular",
    "D": "Dermatology", "G": "Genito-urinary & sex hormones", "H": "Systemic hormonal preparations",
    "J": "Anti-infectives", "L": "Antineoplastic & immunomodulating", "M": "Musculoskeletal",
    "N": "Nervous system", "P": "Antiparasitic", "R": "Respiratory", "S": "Sensory organs", "V": "Various",
}
_ONC_MESH = re.compile(r"neoplas|carcinom|cancer|lymphom|leuk[a]?emi|melanom|myelom|sarcom|gliom|blastom|"
                       r"mesotheliom|tumou?r|myelodysplastic|macroglobulin", re.I)
_HEM_MESH = re.compile(r"an[a]?emia|hemophilia|haemophilia|thrombocytop|neutropeni|von willebrand|"
                       r"thalass|sickle|hemoglobinuria|haemoglobinuria|purpura|coagulation", re.I)


def classify(atc: str | None, mesh: str | None, indication: str | None, orphan: bool | None,
             known_areas: Iterable[str] = ()) -> dict[str, Any]:
    """Therapeutic area flags from the source's own coding (ATC, MeSH) and indication text."""
    atc = (atc or "").upper().strip()
    known = set(known_areas)
    onc = atc.startswith(("L01", "L02")) or bool(mesh and _ONC_MESH.search(mesh)) or "ONCOLOGY" in known
    hem = atc.startswith("B") or bool(mesh and _HEM_MESH.search(mesh)) or "HEMATOLOGY" in known
    rare = bool(orphan) or "RARE_DISEASE" in known
    if indication and not (onc or hem or rare):
        c = drug_classifier.classify(indication)
        if c.confidence >= drug_classifier.AUTO_THRESHOLD:
            onc = onc or drug_classifier.ONCOLOGY in c.therapeutic_areas
            hem = hem or drug_classifier.HEMATOLOGY in c.therapeutic_areas
            rare = rare or drug_classifier.RARE_DISEASE in c.therapeutic_areas
    if onc:
        area = "Oncology"
    elif hem:
        area = "Hematology"
    elif atc[:1] in ATC_GROUPS:
        area = ATC_GROUPS[atc[:1]]
    elif rare:
        area = "Rare Disease"
    else:
        area = None
    return {"therapeutic_area": area, "is_oncology": onc, "is_rare": rare}


# ------------------------------------------------------------------ EMA
EMA_STATUS = {
    "authorised": ("Approved", None),
    "withdrawn": ("Withdrawn", "Marketing authorisation withdrawn"),
    "application withdrawn": ("Withdrawn", "Application withdrawn before an EU decision; never authorised"),
    "refused": ("Refused", "Marketing authorisation refused"),
    "opinion": ("Under Review", "CHMP opinion adopted; European Commission decision pending"),
    "lapsed": ("Expired", "Marketing authorisation lapsed"),
    "expired": ("Expired", "Marketing authorisation expired"),
    "revoked": ("Withdrawn", "Marketing authorisation revoked"),
    "suspended": ("Suspended", "Marketing authorisation suspended"),
}


def _d(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%d.%m.%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _yes(v: Any) -> bool:
    return str(v or "").strip().lower() == "yes"


def parse_ema(content: bytes) -> tuple[list[dict], list[dict]]:
    """EMA medicines file -> one row per active substance with its EU centralised record."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    header: list[str] | None = None
    products: list[dict] = []
    errors: list[dict] = []
    for row in ws.iter_rows(values_only=True):
        if header is None:
            if row and row[0] == "Category" and "EMA product number" in row:
                header = [str(h or "").replace("\n", " ").strip() for h in row]
            continue
        rec = dict(zip(header, row))
        if rec.get("Category") != "Human":
            continue
        name = rec.get("International non-proprietary name (INN) / common name") or rec.get("Active substance")
        key = match_key(str(name or ""))
        if not key:
            errors.append({"name": rec.get("Name of medicine"), "error": "No INN / active substance in EMA file"})
            continue
        products.append({**rec, "_key": key, "_inn": str(name)})
    wb.close()
    if header is None:
        raise ValueError("The EMA file layout was not recognised (no 'Category' header row)")

    groups: dict[str, list[dict]] = defaultdict(list)
    for p in products:
        groups[p["_key"]].append(p)

    rows = []
    for key, items in groups.items():
        def status_of(p: dict) -> tuple[str, str | None]:
            return EMA_STATUS.get(str(p.get("Medicine status") or "").strip().lower(), ("Not Verified", "Status not recognised"))

        items.sort(key=lambda p: (STATUS_PRIORITY[status_of(p)[0]], _d(p.get("Marketing authorisation date")) or "9999"))
        best = items[0]
        status, note = status_of(best)
        authorised = [p for p in items if status_of(p)[0] == "Approved"]
        ma_dates = sorted(filter(None, (_d(p.get("Marketing authorisation date")) for p in (authorised or items))))
        notes = [note] if note else []
        if status in ("Withdrawn", "Expired"):
            ended = _d(best.get("Withdrawal / expiry / revocation / lapse of marketing authorisation date"))
            if ended:
                notes.append(f"on {ended}")
        if status == "Refused" and _d(best.get("Refusal of marketing authorisation date")):
            notes.append(f"on {_d(best.get('Refusal of marketing authorisation date'))}")
        if len(items) > 1:
            notes.append(f"{len(items)} EU products share this substance ({len(authorised)} authorised)")
        notes.append("EU centralised authorisation is not proof of marketing in every EU country")
        orphan = None
        if authorised:
            orphan = any(_yes(p.get("Orphan medicine")) for p in authorised)
        atc = str(best.get("ATC code (human)") or "").strip() or None
        mesh = re.sub(r"\s*;\s*", "; ", str(best.get("Therapeutic area (MeSH)") or "").strip()) or None
        indication = str(best.get("Therapeutic indication") or "").strip() or None
        flags = classify(atc, mesh, indication, orphan)
        approval_date = ma_dates[0] if status in ("Approved", "Withdrawn", "Expired", "Suspended") and ma_dates else None
        if status == "Withdrawn" and not _d(best.get("Marketing authorisation date")):
            approval_date = None  # application withdrawn: there was never an authorisation date
        rows.append({
            "match_key": key,
            "generic_name": display_name(best["_inn"]),
            "brand_names": sorted({str(p.get("Name of medicine")).strip() for p in items if p.get("Name of medicine")}),
            "active_ingredient": str(best.get("Active substance") or "").strip() or None,
            "combination_ingredients": ingredients(best["_inn"]) if " + " in key else [],
            "sub_therapeutic_area": mesh,
            "drug_class": str(best.get("Pharmacotherapeutic group (human)") or "").strip() or None,
            "atc_code": atc,
            "mah": str(best.get("Marketing authorisation developer / applicant / holder") or "").strip() or None,
            "indication": indication,
            "orphan_eu": orphan,
            "drug_type": "Advanced therapy (ATMP)" if _yes(best.get("Advanced therapy")) else None,
            "source_url": best.get("Medicine URL"),
            **flags,
            "approval": {
                "country": "EU", "region": "Europe", "authority": "EMA / European Commission",
                "approval_status": status,
                "approval_date": approval_date,
                "ma_number": ", ".join(p["EMA product number"] for p in (authorised or [best])[:10] if p.get("EMA product number")),
                "approval_type": "EU centralised" + (" (conditional)" if _yes(best.get("Conditional approval")) else "")
                                 + (" (exceptional circumstances)" if _yes(best.get("Exceptional circumstances")) else ""),
                "indication_approved": indication,
                "source_url": best.get("Medicine URL") or EMA_PAGE_URL,
                "marketing_status": None,
                "source_checked": f"{EMA_CREDIT} ({EMA_FILE_URL})",
                "search_terms": best["_inn"],
                "verification_notes": "; ".join(notes),
            },
        })
    return rows, errors


# ------------------------------------------------------------------ FDA
def parse_fda(zip_bytes: bytes, labels: dict[str, dict] | None = None, export_date: str | None = None) -> tuple[list[dict], list[dict]]:
    """openFDA Drugs@FDA bulk export -> one row per active substance with its US record.

    `labels` maps application number -> {indication, label_url, therapeutic_areas} from the
    existing FDA module (label-based indications already classified there)."""
    labels = labels or {}
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    data = json.loads(z.read(z.namelist()[0]))
    groups: dict[str, list[dict]] = defaultdict(list)
    errors: list[dict] = []
    for app in data.get("results", []):
        appl = app.get("application_number") or ""
        if not appl.startswith(("NDA", "BLA")):
            continue
        prods = [p for p in app.get("products", []) if p.get("marketing_status") in ("Prescription", "Discontinued")]
        if not prods:
            continue  # OTC-only or tentative approval only
        orig = [s for s in app.get("submissions", []) if s.get("submission_type") == "ORIG" and s.get("submission_status") == "AP"]
        if not orig and not any(s.get("submission_status") == "AP" for s in app.get("submissions", [])):
            continue
        names = {"; ".join(sorted(ai.get("name", "") for ai in p.get("active_ingredients", []))) for p in prods}
        name = sorted(names, key=len)[0] if names else ""
        key = match_key(name)
        if not key:
            errors.append({"name": appl, "error": "No active ingredient in openFDA record"})
            continue
        docs = [d for s in app.get("submissions", []) for d in (s.get("application_docs") or []) if d.get("type") == "Label"]
        docs.sort(key=lambda d: d.get("date") or "")
        groups[key].append({
            "appl": appl, "name": name, "sponsor": app.get("sponsor_name"), "products": prods,
            "orig_date": _d(min((s.get("submission_status_date") for s in orig), default=None)) if orig else None,
            "openfda": app.get("openfda") or {}, "label_doc": docs[-1]["url"].replace("http://", "https://") if docs else None,
        })

    rows = []
    for key, apps in groups.items():
        apps.sort(key=lambda a: (a["orig_date"] or "9999", a["appl"]))
        first = apps[0]
        marketed = any(p.get("marketing_status") == "Prescription" for a in apps for p in a["products"])
        lab = next((labels[a["appl"]] for a in apps if a["appl"] in labels), {})
        areas = lab.get("therapeutic_areas") or []
        indication = lab.get("indication")
        flags = classify(None, None, indication, None, areas)
        of = first["openfda"]
        types = sorted({a["appl"][:3] for a in apps})
        dated = [a for a in apps if a["orig_date"]]
        rows.append({
            "match_key": key,
            "generic_name": display_name((of.get("generic_name") or [first["name"]])[0] if len(of.get("generic_name") or []) == 1 else first["name"]),
            "brand_names": sorted({p.get("brand_name").strip() for a in apps for p in a["products"] if p.get("brand_name")}),
            "active_ingredient": first["name"].title() if first["name"].isupper() else first["name"],
            "combination_ingredients": ingredients(first["name"]) if " + " in key else [],
            "dosage_form": ", ".join(sorted({p.get("dosage_form", "").title() for p in first["products"] if p.get("dosage_form")}))[:200] or None,
            "strength": ", ".join(sorted({re.sub(r"\s*\*\*.*?\*\*", "", ai.get("strength", "")).strip()
                                          for p in first["products"] for ai in p.get("active_ingredients", []) if ai.get("strength")}))[:300] or None,
            "route": ", ".join(sorted({p.get("route", "").title() for p in first["products"] if p.get("route")}))[:200] or None,
            "manufacturer": first["sponsor"].title() if first.get("sponsor") else None,
            "drug_class": ", ".join((of.get("pharm_class_epc") or [])[:3]) or None,
            "indication": indication,
            "drug_type": "Biologic (BLA)" if types == ["BLA"] else None,
            "source_url": FDA_APP_URL.format(re.sub(r"\D", "", first["appl"])),
            **flags,
            "approval": {
                "country": "US", "region": "USA", "authority": "FDA",
                "approval_status": "Approved",
                "approval_date": dated[0]["orig_date"] if dated else None,
                "application_number": ", ".join(a["appl"] for a in apps[:12]) + (f" (+{len(apps) - 12} more)" if len(apps) > 12 else ""),
                "approval_type": " / ".join(types),
                "indication_approved": indication,
                "label_url": lab.get("label_url") or first["label_doc"],
                "source_url": FDA_APP_URL.format(re.sub(r"\D", "", first["appl"])),
                "marketing_status": "Marketed (prescription)" if marketed else "All listed products discontinued",
                "source_checked": f"openFDA Drugs@FDA export {export_date or ''}".strip(),
                "search_terms": first["name"],
                "verification_notes": None if dated else "Original approval date not stated in openFDA",
            },
        })
    return rows, errors


# ------------------------------------------------------------------ CSV (sheet tabs)
APPROVAL_COLUMNS = ["Approval_Record_ID", "Drug_ID", "Generic_Name", "Brand_Name", "Region", "Country", "Regulatory_Authority",
                    "Approval_Status", "Approval_Date", "Application_Number", "Marketing_Authorisation_Number", "Approval_Type",
                    "Indication_Approved", "Product_Label_URL", "Regulatory_Source_URL", "Last_Verified_Date", "Verified_By",
                    "Verification_Notes", "Search_Terms", "Source_Checked", "Marketing_Status"]
MASTER_COLUMNS = ["Drug_ID", "KEGG_Drug_ID", "Generic_Name", "Brand_Name", "Alternative_Name", "Active_Ingredient",
                  "Combination_Ingredients", "Therapeutic_Area", "Sub_Therapeutic_Area", "Drug_Class", "ATC_Code", "Dosage_Form",
                  "Strength", "Route_of_Administration", "Manufacturer", "Marketing_Authorisation_Holder", "Indication",
                  "Orphan_Drug_Status", "Drug_Type", "Source_URL", "Record_Created_Date", "Last_Updated", "Verification_Status"]
INDICATION_COLUMNS = ["Drug_ID", "Generic_Name", "Indication", "Disease_Category", "Therapeutic_Area", "Country",
                      "Approval_Status", "Approval_Date", "Source_URL", "Verification_Status"]
HISTORY_COLUMNS = ["History_ID", "Drug_ID", "Country", "Regulatory_Authority", "Previous_Status", "New_Status",
                   "Effective_Date", "Update_Description", "Source_URL", "Updated_On"]
REQUEST_COLUMNS = ["Request_ID", "Patient_Reference_ID", "Doctor_ID", "Drug_ID", "Requested_Drug_Name", "Generic_Name",
                   "Brand_Name", "Strength", "Dosage_Form", "Required_Country", "Treating_Doctor", "Request_Date",
                   "Request_Status", "Regulatory_Check_Status", "Assigned_Department", "Remarks"]


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (h or "").strip().lower()).strip("_")


def read_table(content: bytes, filename: str = "") -> list[dict[str, str]]:
    """CSV or XLSX -> list of {normalised_header: value}."""
    if filename.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        rows = list(wb.active.iter_rows(values_only=True))
        wb.close()
        if not rows:
            return []
        header = [_norm_header(str(h or "")) for h in rows[0]]
        out = []
        for r in rows[1:]:
            rec = {header[i]: ("" if v is None else (_d(v) if isinstance(v, (datetime, date)) else str(v)).strip())
                   for i, v in enumerate(r) if i < len(header) and header[i]}
            if any(rec.values()):
                out.append(rec)
        return out
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [{_norm_header(k): (v or "").strip() for k, v in r.items() if k} for r in reader if any((v or "").strip() for v in r.values())]


def _url_ok(u: str) -> bool:
    return bool(re.match(r"^https?://[^\s]+\.[^\s]+", u or ""))


def validate_approval_rows(raw: list[dict[str, str]], verified_by: str) -> tuple[list[dict], list[dict]]:
    """Drug_Country_Approval tab -> intl_import rows. Every status other than 'Not Verified'
    must carry the official source URL that was checked."""
    ok, bad = [], []
    for i, r in enumerate(raw, start=2):
        problems = []
        code = country_code(r.get("country"))
        if not code:
            problems.append(f"Unknown country '{r.get('country', '')}' (use a 2-letter code such as JP, GB, DE)")
        status = next((s for s in STATUSES if s.lower() == (r.get("approval_status") or "").strip().lower()), None)
        if not status:
            problems.append(f"Approval_Status must be one of: {', '.join(STATUSES)}")
        src = r.get("regulatory_source_url", "")
        if status and status != "Not Verified" and not _url_ok(src):
            problems.append("Regulatory_Source_URL (the official page you checked) is required")
        if r.get("product_label_url") and not _url_ok(r["product_label_url"]):
            problems.append("Product_Label_URL is not a valid link")
        ad = r.get("approval_date", "")
        approval_date = _d(ad) if ad else None
        if ad and not approval_date:
            problems.append(f"Approval_Date '{ad}' not understood (use YYYY-MM-DD)")
        drug_id = r.get("drug_id", "")
        generic = r.get("generic_name", "")
        if not drug_id and not generic:
            problems.append("Drug_ID or Generic_Name is required")
        if problems:
            bad.append({"row": i, "name": drug_id or generic, "errors": problems})
            continue
        name, region, authority = country_meta(code)
        lvd = _d(r.get("last_verified_date", "")) if r.get("last_verified_date") else None
        ok.append({
            "row": i,
            "drug_id": drug_id or None,
            "kegg_drug_id": r.get("kegg_drug_id") or None,
            "match_key": match_key(generic) if generic else None,
            "generic_name": display_name(generic) if generic else None,
            "brand_names": [b.strip() for b in re.split(r"[;|]", r.get("brand_name", "")) if b.strip()],
            "approval": {
                "country": code, "region": region,
                "authority": r.get("regulatory_authority") or authority,
                "approval_status": status, "approval_date": approval_date,
                "application_number": r.get("application_number") or None,
                "ma_number": r.get("marketing_authorisation_number") or None,
                "approval_type": r.get("approval_type") or None,
                "indication_approved": r.get("indication_approved") or None,
                "label_url": r.get("product_label_url") or None,
                "source_url": src or None,
                "marketing_status": r.get("marketing_status") or None,
                "source_checked": r.get("source_checked") or src or None,
                "search_terms": r.get("search_terms") or generic or None,
                "last_verified_date": lvd or date.today().isoformat(),
                "verified_by": r.get("verified_by") or verified_by,
                "verification_notes": r.get("verification_notes") or None,
            },
        })
    return ok, bad


MASTER_EDITABLE = {
    "kegg_drug_id": "kegg_drug_id", "generic_name": "generic_name", "alternative_name": "alternative_names",
    "active_ingredient": "active_ingredient", "therapeutic_area": "therapeutic_area",
    "sub_therapeutic_area": "sub_therapeutic_area", "drug_class": "drug_class", "atc_code": "atc_code",
    "dosage_form": "dosage_form", "strength": "strength", "route_of_administration": "route",
    "manufacturer": "manufacturer", "marketing_authorisation_holder": "mah", "indication": "indication",
    "drug_type": "drug_type", "source_url": "source_url", "verification_status": "verification_status",
    "brand_name": "brand_names",
}


def master_patch(r: dict[str, str]) -> tuple[dict, list[str]]:
    """International_Drug_Master row -> fields to update. Empty cells never erase data."""
    patch: dict[str, Any] = {}
    problems: list[str] = []
    for col, field in MASTER_EDITABLE.items():
        v = (r.get(col) or "").strip()
        if not v:
            continue
        if field in ("brand_names", "alternative_names"):
            patch[field] = sorted({b.strip() for b in re.split(r"[;|]", v) if b.strip()})
        else:
            patch[field] = v
    if "kegg_drug_id" in patch and not re.fullmatch(r"D\d{5}", patch["kegg_drug_id"]):
        problems.append("KEGG_Drug_ID must look like D12345")
    if "verification_status" in patch and patch["verification_status"] not in ("Verified", "Source-imported", "Needs Review", "Not Verified"):
        problems.append("Verification_Status must be Verified, Source-imported, Needs Review or Not Verified")
    if "source_url" in patch and not _url_ok(patch["source_url"]):
        problems.append("Source_URL is not a valid link")
    return patch, problems


def orphan_label(d: dict) -> str:
    parts = [n for n, k in (("EU", "orphan_eu"), ("US", "orphan_us"), ("Japan", "orphan_jp")) if d.get(k)]
    if parts:
        return "Orphan (" + ", ".join(parts) + ")"
    if d.get("orphan_eu") is False:
        return "Not an EU orphan medicine"
    return "Not verified"


# ------------------------------------------------------------------ doctor relevance
# Suggested relevance only: a doctor's specialty never proves that they prescribe a medicine.
SPECIALTY_RULES: list[tuple[str, re.Pattern, str]] = [
    ("Oncology", re.compile(r"\bonc|oncolog|cancer", re.I), "oncology"),
    ("Hematology", re.compile(r"hema|haema|hemat|haemat", re.I), "hematology"),
    ("Neurology", re.compile(r"neuro", re.I), "nervous"),
    ("Nephrology", re.compile(r"nephro|kidney|renal", re.I), "renal"),
    ("Genetics / rare disease", re.compile(r"genet|metabolic", re.I), "rare"),
    ("Gastroenterology / hepatology", re.compile(r"gastro|hepat|liver", re.I), "alimentary"),
    ("Transplant", re.compile(r"transplant", re.I), "transplant"),
    ("Cardiology", re.compile(r"cardio", re.I), "cardio"),
    ("Endocrinology", re.compile(r"endocrin|diabet", re.I), "hormonal"),
    ("Pulmonology", re.compile(r"pulmo|respir|chest", re.I), "respiratory"),
    ("Rheumatology / immunology", re.compile(r"rheum|immunolog", re.I), "immuno"),
    ("Ophthalmology", re.compile(r"ophthal|eye", re.I), "sensory"),
    ("Dermatology", re.compile(r"derma", re.I), "derma"),
    ("Infectious disease", re.compile(r"infect", re.I), "infect"),
]

_DRUG_TAGS = {
    "oncology": lambda d: d.get("is_oncology"),
    "hematology": lambda d: (d.get("therapeutic_area") == "Hematology") or (d.get("atc_code") or "").startswith("B")
        or bool(_HEM_MESH.search(d.get("sub_therapeutic_area") or "")) or (d.get("is_oncology") and bool(re.search(r"lymphom|leuk|myelom", (d.get("sub_therapeutic_area") or "") + " " + (d.get("indication") or "")[:400], re.I))),
    "nervous": lambda d: (d.get("atc_code") or "").startswith("N") or bool(re.search(r"neuro|epilep|muscular atrophy|dystroph|sclerosis|parkinson|alzheimer|migraine", (d.get("sub_therapeutic_area") or "") + " " + (d.get("indication") or "")[:400], re.I)),
    "renal": lambda d: bool(re.search(r"kidney|renal|nephr|hemolytic uremic|haemolytic uraemic|cystinosis|hyperoxaluria", (d.get("sub_therapeutic_area") or "") + " " + (d.get("indication") or "")[:400], re.I)),
    "rare": lambda d: d.get("is_rare") or bool(d.get("orphan_eu") or d.get("orphan_us") or d.get("orphan_jp")),
    "alimentary": lambda d: (d.get("atc_code") or "").startswith("A") or bool(re.search(r"liver|hepat|crohn|colitis|bowel", (d.get("sub_therapeutic_area") or ""), re.I)),
    "transplant": lambda d: (d.get("atc_code") or "").startswith("L04") or bool(re.search(r"transplant|graft", d.get("sub_therapeutic_area") or "", re.I)),
    "cardio": lambda d: (d.get("atc_code") or "").startswith("C"),
    "hormonal": lambda d: (d.get("atc_code") or "").startswith(("H", "A10")),
    "respiratory": lambda d: (d.get("atc_code") or "").startswith("R"),
    "immuno": lambda d: (d.get("atc_code") or "").startswith(("L04", "M")),
    "sensory": lambda d: (d.get("atc_code") or "").startswith("S"),
    "derma": lambda d: (d.get("atc_code") or "").startswith("D"),
    "infect": lambda d: (d.get("atc_code") or "").startswith("J"),
}


def relevant_specialties(drug: dict) -> list[tuple[str, re.Pattern]]:
    """Doctor specialties that may be relevant to a drug (for suggestions needing human confirmation)."""
    return [(label, rx) for label, rx, tag in SPECIALTY_RULES if _DRUG_TAGS[tag](drug)]


def specialty_reason(drug: dict, specialty: str | None, sub_department: str | None) -> str | None:
    text = " ".join(filter(None, [specialty, sub_department]))
    for label, rx in relevant_specialties(drug):
        if rx.search(text):
            return f"Specialty matches {label}"
    return None
