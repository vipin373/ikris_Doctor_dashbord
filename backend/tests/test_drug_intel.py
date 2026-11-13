import io
import json
import zipfile

import openpyxl
import pytest
from fastapi import HTTPException

from app.api import drug_intel as api
from app.services import drug_intel as di


# ---------------------------------------------------------------- names / duplicates
@pytest.mark.parametrize("a,b", [
    ("IMATINIB MESYLATE", "imatinib"),
    ("EMTRICITABINE; TENOFOVIR ALAFENAMIDE FUMARATE", "emtricitabine / tenofovir alafenamide"),
    ("trastuzumab-dkst", "Trastuzumab"),
    ("fam-trastuzumab deruxtecan-nxki", "trastuzumab deruxtecan"),
    ("ELTROMBOPAG OLAMINE", "eltrombopag"),
    ("HYDROXYUREA", "hydroxycarbamide"),
])
def test_same_substance_same_key(a, b):
    assert di.match_key(a) == di.match_key(b)


def test_distinct_substances_stay_distinct():
    assert di.match_key("insulin glargine") != di.match_key("insulin aspart")
    assert di.match_key("sodium chloride") == "sodium chloride"  # not collapsed to "sodium"
    assert di.match_key("") == ""


def test_country_codes():
    assert di.country_code("Japan") == "JP" and di.country_code("uk") == "GB" and di.country_code("de") == "DE"
    assert di.country_code("Atlantis") is None
    assert di.country_meta("JP")[1] == "Japan" and di.country_meta("GB")[1] == "Europe"


# ---------------------------------------------------------------- EMA parser
def _ema_xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Content type:", "Medicine"])
    header = ["Category", "Name of medicine", "EMA product number", "Medicine status", "International non-proprietary name (INN) / common name",
              "Active substance", "Therapeutic area (MeSH)", "ATC code (human)", "Pharmacotherapeutic group\n(human)", "Therapeutic indication",
              "Orphan medicine", "Advanced therapy", "Conditional approval", "Exceptional circumstances",
              "Marketing authorisation developer / applicant / holder", "Marketing authorisation date",
              "Refusal of marketing authorisation date", "Withdrawal / expiry / revocation / lapse of marketing authorisation date", "Medicine URL"]
    ws.append(header)
    for r in rows:
        ws.append([r.get(h.replace("\n", " "), r.get(h)) for h in header])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_parse_ema_aggregates_products_and_maps_status():
    content = _ema_xlsx([
        {"Category": "Human", "Name of medicine": "Glivec", "EMA product number": "EMEA/H/C/000406", "Medicine status": "Authorised",
         "International non-proprietary name (INN) / common name": "imatinib", "ATC code (human)": "L01EA01",
         "Therapeutic indication": "CML", "Orphan medicine": "No", "Marketing authorisation date": "07/11/2001",
         "Medicine URL": "https://www.ema.europa.eu/en/medicines/human/EPAR/glivec"},
        {"Category": "Human", "Name of medicine": "Imatinib Teva", "EMA product number": "EMEA/H/C/002585", "Medicine status": "Withdrawn",
         "International non-proprietary name (INN) / common name": "imatinib", "Marketing authorisation date": "08/01/2013"},
        {"Category": "Human", "Name of medicine": "Nodrug", "EMA product number": "EMEA/H/C/009999", "Medicine status": "Refused",
         "International non-proprietary name (INN) / common name": "examplumab", "Refusal of marketing authorisation date": "01/02/2020"},
        {"Category": "Veterinary", "Name of medicine": "Vetx", "Medicine status": "Authorised",
         "International non-proprietary name (INN) / common name": "vetmab"},
    ])
    rows, errors = di.parse_ema(content)
    by = {r["match_key"]: r for r in rows}
    assert set(by) == {"imatinib", "examplumab"}  # veterinary excluded
    im = by["imatinib"]
    assert im["approval"]["approval_status"] == "Approved" and im["approval"]["approval_date"] == "2001-11-07"
    assert im["brand_names"] == ["Glivec", "Imatinib Teva"] and im["is_oncology"] and im["orphan_eu"] is False
    assert "not proof of marketing" in im["approval"]["verification_notes"]
    assert di.EMA_CREDIT in im["approval"]["source_checked"]
    ref = by["examplumab"]["approval"]
    assert ref["approval_status"] == "Refused" and ref["approval_date"] is None  # never invent an approval date


# ---------------------------------------------------------------- FDA parser
def test_parse_fda_keeps_only_approved_rx_nda_bla():
    data = {"results": [
        {"application_number": "NDA021588", "sponsor_name": "NOVARTIS",
         "products": [{"brand_name": "GLEEVEC", "marketing_status": "Prescription", "dosage_form": "TABLET", "route": "ORAL",
                       "active_ingredients": [{"name": "IMATINIB MESYLATE", "strength": "100MG"}]}],
         "submissions": [{"submission_type": "ORIG", "submission_status": "AP", "submission_status_date": "20030418"}],
         "openfda": {"generic_name": ["IMATINIB MESYLATE"]}},
        {"application_number": "ANDA200000", "products": [{"marketing_status": "Prescription", "active_ingredients": [{"name": "IMATINIB"}]}],
         "submissions": [{"submission_type": "ORIG", "submission_status": "AP"}]},
        {"application_number": "NDA999999", "products": [{"marketing_status": "Over-the-counter", "active_ingredients": [{"name": "OTCOL"}]}],
         "submissions": [{"submission_type": "ORIG", "submission_status": "AP"}]},
    ]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("drug.json", json.dumps(data))
    rows, _ = di.parse_fda(buf.getvalue(), {"NDA021588": {"indication": "Chronic myeloid leukemia", "therapeutic_areas": ["ONCOLOGY"]}})
    assert [r["match_key"] for r in rows] == ["imatinib"]
    a = rows[0]["approval"]
    assert a["approval_status"] == "Approved" and a["approval_date"] == "2003-04-18" and a["country"] == "US"
    assert a["marketing_status"] == "Marketed (prescription)" and rows[0]["is_oncology"]


# ---------------------------------------------------------------- CSV / manual verification rules
def test_approval_rows_require_source_and_valid_values():
    ok, bad = di.validate_approval_rows([
        {"generic_name": "imatinib", "country": "Japan", "approval_status": "Approved", "approval_date": "2005-07-25",
         "regulatory_source_url": "https://www.pmda.go.jp/x"},
        {"generic_name": "imatinib", "country": "JP", "approval_status": "Approved"},  # no source
        {"generic_name": "imatinib", "country": "Narnia", "approval_status": "Approved", "regulatory_source_url": "https://a.b"},
        {"generic_name": "imatinib", "country": "GB", "approval_status": "approved-ish", "regulatory_source_url": "https://a.b"},
        {"generic_name": "x", "country": "DE", "approval_status": "Not Verified"},  # allowed without a source
    ], "admin@x")
    assert [r["row"] for r in ok] == [2, 6]
    assert ok[0]["approval"]["country"] == "JP" and ok[0]["approval"]["region"] == "Japan" and ok[0]["approval"]["approval_date"] == "2005-07-25"
    assert {b["row"] for b in bad} == {3, 4, 5}
    assert any("Regulatory_Source_URL" in e for e in next(b for b in bad if b["row"] == 3)["errors"])


def test_master_patch_never_erases_and_validates():
    patch, problems = di.master_patch({"drug_id": "IDI-000001", "kegg_drug_id": "D01441", "brand_name": "Glivec; Gleevec", "manufacturer": ""})
    assert patch == {"kegg_drug_id": "D01441", "brand_names": ["Gleevec", "Glivec"]} and not problems
    _, problems = di.master_patch({"kegg_drug_id": "K123"})
    assert problems


def test_read_table_csv_headers_normalised():
    rows = di.read_table("Drug_ID,Approval_Status,Country\nIDI-000001,Approved,JP\n".encode(), "x.csv")
    assert rows == [{"drug_id": "IDI-000001", "approval_status": "Approved", "country": "JP"}]


# ---------------------------------------------------------------- filters
def test_not_verified_filter_includes_missing_records():
    p = dict(api.overview_filters(api.ListFilters(country="JP", status="Not Verified")))
    assert p["country_status"].startswith("not.ov.") and '"JP:Approved"' in p["country_status"] and "Not Verified" not in p["country_status"]
    p = dict(api.overview_filters(api.ListFilters(country="US", status="Approved")))
    assert p["country_status"] == 'cs.{"US:Approved"}'
    p = dict(api.overview_filters(api.ListFilters(region="Europe")))
    assert p["region_status"].startswith("ov.")
    with pytest.raises(HTTPException):
        api.overview_filters(api.ListFilters(status="Maybe"))


def test_search_is_sanitised():
    p = dict(api.overview_filters(api.ListFilters(q="ima*tinib),(or")))
    assert p["search_text"] == "ilike.*ima tinib or*"


# ---------------------------------------------------------------- doctors / roles
def test_specialty_suggestions():
    onc = {"is_oncology": True, "atc_code": "L01EA01", "sub_therapeutic_area": "Leukemia, Myelogenous", "indication": "chronic myeloid leukaemia"}
    labels = [l for l, _ in di.relevant_specialties(onc)]
    assert "Oncology" in labels and "Hematology" in labels
    assert di.specialty_reason(onc, "ONC", None) == "Specialty matches Oncology"
    assert di.specialty_reason({"atc_code": "C09AA01"}, "Pediatric Neurology", None) is None
    sma = {"is_rare": True, "orphan_eu": True, "atc_code": "M09AX07", "sub_therapeutic_area": "Muscular Atrophy, Spinal"}
    assert {"Neurology", "Genetics / rare disease"} <= {l for l, _ in di.relevant_specialties(sma)}


def test_admin_only():
    class U:
        is_admin = False
    with pytest.raises(HTTPException) as e:
        api.admin_only(U())
    assert e.value.status_code == 403


def test_request_rejects_patient_names():
    class U:
        is_admin = False
        role = "NPP"

        def ensure_department(self, d):
            if d != "NPP":
                raise HTTPException(403, "no")
            return [d]
    with pytest.raises(HTTPException):
        api._check_request(api.RequestIn(requested_drug_name="x", patient_reference_id="Ravi Kumar"), U())
    data = api._check_request(api.RequestIn(requested_drug_name="x", patient_reference_id="NPP-2026-01"), U())
    assert data["assigned_department"] == "NPP"
    with pytest.raises(HTTPException):
        api._check_request(api.RequestIn(requested_drug_name="x", assigned_department="RARE_DISEASES"), U())
    with pytest.raises(HTTPException):
        api._check_request(api.RequestIn(requested_drug_name="x", import_check="Yes"), U())
