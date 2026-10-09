import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.services import bulk_import, fda_service
from app.services.doctor_matcher import doctor_areas, eligibility, pick_auto_drug
from app.services.drug_classifier import classify, verify_ai_classification
from app.services.message_render import context_for, fact_guard, render
from app.services.whatsapp_service import _parse, parse_webhook, whatsapp_number


# ---------------------------------------------------------------- classification
def test_oncology_label_is_classified_with_evidence():
    c = classify("MEKINIST is a kinase inhibitor indicated for the treatment of adult patients with unresectable or "
                 "metastatic melanoma with BRAF V600E mutations.")
    assert c.department == "ONCOLOGY" and c.review_status == "AUTO"
    assert "melanoma" in c.evidence and "metastatic" in c.evidence


def test_hemophilia_spans_hematology_and_rare():
    c = classify("indicated for routine prophylaxis to reduce the frequency of bleeding episodes in adults and "
                 "children with hemophilia A (congenital factor VIII deficiency).")
    assert c.department == "HEMATOLOGY"
    assert set(c.therapeutic_areas) == {"HEMATOLOGY", "RARE_DISEASE"}


def test_weak_or_missing_evidence_needs_review():
    assert classify(None).review_status == "NEEDS_REVIEW"
    weak = classify("indicated for the treatment of tumors of the skin in adults who are candidates for therapy.")
    assert weak.department == "NEEDS_REVIEW" and weak.review_status == "NEEDS_REVIEW"


def test_unrelated_indication_is_other():
    c = classify("indicated as an adjunct to diet and exercise to improve glycemic control in adults with type 2 diabetes mellitus.")
    assert c.department == "OTHER"


def test_ai_classification_must_quote_the_label():
    text = "indicated for the treatment of Gaucher disease type 1 in adults."
    ok = verify_ai_classification(text, {"department": "RARE_DISEASE", "confidence": 0.9,
                                         "evidence_quote": "Gaucher disease type 1", "reason": "lysosomal disorder"})
    assert ok.review_status == "AUTO"
    invented = verify_ai_classification(text, {"department": "ONCOLOGY", "confidence": 0.99,
                                               "evidence_quote": "treats leukemia"})
    assert invented.review_status == "NEEDS_REVIEW"


# ---------------------------------------------------------------- FDA normalisation
LABEL = {
    "set_id": "abc-123", "effective_time": "20250101",
    "indications_and_usage": ["1 INDICATIONS AND USAGE MEKINIST is indicated for metastatic melanoma."],
    "openfda": {"application_number": ["NDA204114", "ANDA000001"], "brand_name": ["Mekinist"],
                "generic_name": ["TRAMETINIB"], "manufacturer_name": ["Novartis Pharmaceuticals Corporation"],
                "substance_name": ["TRAMETINIB DIMETHYL SULFOXIDE"], "route": ["ORAL"],
                "pharm_class_epc": ["Kinase Inhibitor [EPC]"]},
}
APP = {
    "application_number": "NDA204114", "sponsor_name": "NOVARTIS",
    "products": [{"brand_name": "MEKINIST", "dosage_form": "TABLET", "route": "ORAL", "marketing_status": "Prescription",
                  "active_ingredients": [{"name": "TRAMETINIB DIMETHYL SULFOXIDE", "strength": "EQ 0.5MG BASE"}]}],
    "submissions": [
        {"submission_type": "ORIG", "submission_status": "AP", "submission_status_date": "20130529"},
        {"submission_type": "SUPPL", "submission_status": "AP", "submission_status_date": "20240301"},
    ],
}


def test_build_drug_from_fda_records():
    lb = fda_service.label_summary(LABEL)
    assert lb["application_numbers"] == ["NDA204114"]
    assert lb["indication_full"].startswith("MEKINIST is indicated")
    d = fda_service.build_drug("NDA204114", lb, fda_service.application_summary(APP))
    assert d["approval_date"] == "2013-05-29" and d["latest_action_date"] == "2024-03-01"
    assert d["fda_status"] == "Approved" and d["manufacturer"] == "Novartis"
    assert d["drug_name"] == "Mekinist" and d["generic_name"] == "Trametinib"
    assert d["drugs_at_fda_url"].endswith("ApplNo=204114")
    assert d["classification"]["department"] == "ONCOLOGY"
    # same input -> same hash (so re-syncs count as unchanged)
    assert d["record_hash"] == fda_service.build_drug("NDA204114", lb, fda_service.application_summary(APP))["record_hash"]


def test_missing_drugs_at_fda_record_is_flagged_not_invented():
    d = fda_service.build_drug("BLA125000", fda_service.label_summary(LABEL), {})
    assert d["approval_date"] is None and d["fda_status"] is None and d["drugs_at_fda_url"] is None
    assert any("No Drugs@FDA record" in f for f in d["review_flags"])


def test_sync_chunk_dedupes_and_resumes(monkeypatch):
    calls = []

    async def fake_get(client, endpoint, search, limit, skip=0):
        calls.append((endpoint, skip))
        if endpoint == "label":
            if skip >= 50:
                return {"meta": {"results": {"total": 60}, "last_updated": "2026-10-08"}, "results": []}
            return {"meta": {"results": {"total": 60}, "last_updated": "2026-10-08"}, "results": [LABEL, LABEL]}
        return {"results": [APP]}

    monkeypatch.setattr(fda_service, "fda_get", fake_get)
    monkeypatch.setattr(fda_service, "build_streams", lambda since=None: [{"q": "x", "skip": 0, "total": None}])
    written, runs = [], []

    async def write(drugs, d):
        written.extend(drugs)
        return {"new": len(drugs), "updated": 0, "unchanged": 0}

    async def save(run):
        runs.append(run)
        return "run-1"

    res = asyncio.run(fda_service.run_sync_chunk(fda_service.SyncStore(write, save), None, budget_seconds=5))
    assert res["done"] and res["status"] == "SUCCESS"
    assert [d["application_number"] for d in written] == ["NDA204114"]  # two labels, one application
    assert runs[-1]["new"] == 1 and runs[-1]["finished"]


def test_schedule_due():
    now = datetime(2026, 10, 9, tzinfo=timezone.utc)
    last = {"finished_at": (now - timedelta(days=2)).isoformat()}
    assert fda_service.sync_due({"schedule": "daily"}, last, now)
    assert not fda_service.sync_due({"schedule": "weekly"}, last, now)
    assert not fda_service.sync_due({"schedule": "manual"}, None, now)


# ---------------------------------------------------------------- doctors & messages
def test_doctor_areas_and_eligibility():
    assert doctor_areas({"department": "NPP", "sub_department": "Oncology", "specialty": "ONC"}) == ["ONCOLOGY"]
    assert doctor_areas({"department": "NPP", "sub_department": "Hematology", "specialty": "HEMA"}) == ["HEMATOLOGY"]
    assert doctor_areas({"department": "RARE_DISEASES", "sub_department": "Neuro"}) == ["RARE_DISEASE"]
    assert doctor_areas({"department": "NPP", "specialty": "Hemato-Oncologist"}) == ["ONCOLOGY", "HEMATOLOGY"]
    assert doctor_areas({"department": "NPP"}) == []
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    ok, until = eligibility({"next_eligible_at": future})
    assert not ok and until
    started = datetime.now(timezone.utc) - timedelta(minutes=5)
    ok2, _ = eligibility({"next_eligible_at": future, "last_message_sent_at": datetime.now(timezone.utc).isoformat()}, since=started)
    assert ok2  # window opened by this same campaign


def test_auto_pick_prefers_unsent_and_spreads():
    pool = [{"id": "a", "last_sent_to_doctor": "2026-01-01"}, {"id": "b", "last_sent_to_doctor": None},
            {"id": "c", "last_sent_to_doctor": None}]
    used = {"b": 3}
    assert pick_auto_drug(pool, used)["id"] == "c"


def test_render_never_guesses_missing_values():
    ctx = context_for({"doctor_name": "Rajesh Sharma", "institute": "Apollo"},
                      {"drug_name": "Mekinist", "active_ingredient": "Trametinib", "fda_status": "Approved",
                       "approval_date": "2013-05-29", "department": "ONCOLOGY"}, {"name": "Ikris"})
    out, missing, unknown = render("Dear {{doctor_name}}, {{drug_name}} ({{active_ingredient}}) {{fda_approval_date}} "
                                   "{{indication}} {{foo}}", ctx)
    assert out.startswith("Dear Dr. Rajesh Sharma, Mekinist (Trametinib) 29 May 2013")
    assert missing == ["indication"] and unknown == ["foo"]


def test_fact_guard_flags_invented_numbers():
    facts = ["Mekinist", "2013-05-29", "EQ 0.5MG BASE"]
    assert fact_guard("Approved in 2013 for melanoma.", facts) == []
    assert "85%" in fact_guard("Shows 85% response rate.", facts)


# ---------------------------------------------------------------- WhatsApp
def test_whatsapp_number_and_provider_parsing():
    assert whatsapp_number("98765 43210") == "919876543210"
    assert whatsapp_number("12345") is None

    class R:
        def __init__(self, code, body):
            self.status_code, self._b, self.text = code, body, str(body)

        def json(self):
            return self._b

    ok = _parse(R(200, {"messaging_product": "whatsapp", "messages": [{"id": "wamid.X"}]}))
    assert ok.ok and ok.provider_message_id == "wamid.X"
    bad = _parse(R(400, {"error": {"message": "Template not found"}}))
    assert not bad.ok and bad.error == "Template not found"
    no_id = _parse(R(200, {"status": "success"}))
    assert not no_id.ok  # never treated as sent without a provider message id


def test_webhook_parsing():
    payload = {"entry": [{"changes": [{"field": "messages", "value": {"statuses": [
        {"id": "wamid.X", "status": "delivered", "timestamp": "1785004200", "recipient_id": "91987"},
        {"id": "wamid.Y", "status": "failed", "errors": [{"title": "Re-engagement message"}]}]}}]}]}
    ev = parse_webhook(payload)
    assert ev[0]["status"] == "DELIVERED" and ev[0]["occurred_at"]
    assert ev[1]["status"] == "FAILED" and ev[1]["error"] == "Re-engagement message"


# ---------------------------------------------------------------- bulk upload
def test_bulk_csv_mapping_and_validation():
    csv = ("Doctor Name,Specialty,Hospital,WhatsApp Number,Email,Department,Frequency,Must See,City\n"
           "Dr. A Kumar,Medical Oncologist,Tata,9876543210,a@x.com,Oncology,15 Days,Yes,Mumbai\n"
           "B Rao,Hematologist,AIIMS,12,,,Weekly,No,Delhi\n"
           "Dr. A Kumar,Medical Oncologist,Tata,9876543210,a@x.com,Oncology,15 Days,Yes,Mumbai\n"
           "C Iyer,Clinical Geneticist,KEM,9123456780,c@x.com,,Monthly,,Pune\n").encode()
    header, rows = bulk_import.read_table("doctors.csv", csv)
    mapping = bulk_import.auto_mapping(header)
    assert mapping["doctor_name"] == 0 and mapping["whatsapp_number"] == 3 and mapping["must_see"] == 7
    existing = [{"id": "d1", "department": "NPP", "sub_department": "Oncology", "doctor_name": "A Kumar",
                 "institute": "Tata", "email_norm": "a@x.com", "phone_norm": None, "name_norm": "a kumar"}]
    res = bulk_import.validate(rows, mapping, existing, ["NPP", "RARE_DISEASES"], None)
    s = res["summary"]
    assert s["total"] == 4 and s["existing"] == 1 and s["new"] == 2 and s["duplicates"] == 1
    assert s["invalid_whatsapp"] == 1 and s["must_see"] == 2
    r0, r1, r2, r3 = res["rows"]
    assert r0["existing_doctor_id"] == "d1" and r0["contact_frequency"] == "15_DAYS"
    assert r1["department"] == "NPP" and r1["sub_department"] == "Hematology" and r1["blocking"]  # no valid contact
    assert r2["duplicate"]
    assert r3["department"] == "RARE_DISEASES" and r3["areas"] == ["RARE_DISEASE"]


def test_bulk_rejects_bad_files():
    with pytest.raises(bulk_import.UploadError):
        bulk_import.read_table("x.pdf", b"%PDF")
    with pytest.raises(bulk_import.UploadError):
        bulk_import.read_table("x.xlsx", b"not a zip")


def test_hyphen_and_space_variants_match():
    c = classify("indicated for the treatment of steroid-refractory acute graft versus host disease in pediatric patients.")
    assert c.department == "HEMATOLOGY"


def test_passing_late_mention_needs_review():
    text = ("indicated in adults and pediatric patients as replacement therapy in primary, secondary and tertiary "
            "congenital or acquired hypothyroidism, and for pituitary thyrotropin suppression. " * 4
            + "Also as an adjunct to surgery and radioiodine therapy in thyroid cancer.")
    c = classify(text)
    assert c.review_status == "NEEDS_REVIEW" and c.therapeutic_areas == ["ONCOLOGY"]


def test_source_row_key_survives_cell_edits():
    from app.services.mapping import TabContext, map_doctor_tab
    ctx = TabContext(spreadsheet_id="s", sheet_name="Doctor List", department="RARE_DISEASES", sub_department=None, specialty=None, mapping={})
    before = map_doctor_tab(ctx, [["Doctor Name", "Email ID"], ["Dr A", "a@x.com"], ["Dr A", "a@x.com"]])
    after = map_doctor_tab(ctx, [["Doctor Name", "Email ID", "Whatsapp number"], ["Dr A", "a@x.com", "918448645084"], ["Dr A", "a@x.com", ""]])
    assert [r.row_key for r in before.doctors] == [r.row_key for r in after.doctors]
    assert before.doctors[0].row_key != before.doctors[1].row_key
    assert after.doctors[0].fields["whatsapp_number"] == "918448645084"


def test_cunnekt_wrapped_response():
    class R:
        status_code = 200
        text = ""

        def __init__(self, b):
            self._b = b

        def json(self):
            return self._b

    ok = _parse(R({"data": {"contacts": [{"input": "918448645084", "wa_id": "918448645084"}],
                            "messages": [{"id": "wamid.HBgM"}], "messaging_product": "whatsapp"}, "status": True}))
    assert ok.ok and ok.provider_message_id == "wamid.HBgM"
    bad = _parse(R({"status": False, "message": "You can not send message out side of message window."}))
    assert not bad.ok and "message window" in bad.error
