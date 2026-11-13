import pytest
from fastapi import HTTPException

from app.api import npp_crm
from app.services.whatsapp_service import parse_inbound


def test_render_doctor_variables():
    d = {"doctor_name": "Dr A", "institute": "AIIMS", "city": "Delhi", "category": "A", "specialty": "Onc"}
    assert npp_crm._render("Dear {{doctor_name}} of {{ hospital }}, {{city}} ({{category}})", d) == "Dear Dr A of AIIMS, Delhi (A)"
    assert npp_crm._render("{{drug_name}}", d) == "{{drug_name}}"  # unknown vars are left visible, never invented


def test_email_html_escapes():
    assert "&lt;script&gt;" in npp_crm._email_html("<script>x</script>\nline2")
    assert "<br>" in npp_crm._email_html("a\nb")


def test_read_csv_table_and_pick():
    rows = npp_crm._read_table("x.csv", "Doctor_ID,Doctor_Name,Email,Doctor_Category\n1,Dr A,a@x.com,B\n2,Dr B,,\n".encode())
    assert rows[0]["doctor category"] == "B" and rows[1]["doctor category"] == ""
    assert npp_crm._pick(rows[0], "doctor category", "category") == "B"


def test_uuid_validation():
    with pytest.raises(HTTPException):
        npp_crm._uuid_list(["not-a-uuid"])
    ok = "123e4567-e89b-12d3-a456-426614174000"
    assert npp_crm._uuid_list([ok, ok]) == [ok]


def test_npp_only_dependency():
    class U:
        departments = ["RARE_DISEASES"]
    with pytest.raises(HTTPException) as e:
        npp_crm.npp_user(U())
    assert e.value.status_code == 403
    class N:
        departments = ["NPP"]
    assert npp_crm.npp_user(N()).departments == ["NPP"]


def test_recipient_rules():
    assert npp_crm._recipient("EMAIL", {"email_norm": None}) == (None, "No valid email address")
    assert npp_crm._recipient("EMAIL", {"email_norm": "a@x.com"}) == ("a@x.com", None)
    to, why = npp_crm._recipient("WHATSAPP", {"whatsapp_number": None})
    assert to is None and why == "No WhatsApp number"


def test_parse_inbound_whatsapp():
    payload = {"entry": [{"changes": [{"value": {"messages": [
        {"id": "wamid.1", "from": "919820344570", "timestamp": "1790000000", "type": "text", "text": {"body": "Please call me"}},
        {"id": "wamid.2", "from": "919820344570", "type": "button", "button": {"text": "Interested"}},
        {"from": "91999"},  # no id -> ignored
    ]}}]}]}
    out = parse_inbound(payload)
    assert [m["text"] for m in out] == ["Please call me", "Interested"]
    assert out[0]["occurred_at"].startswith("2026-")


def test_date_range_periods():
    s, e = npp_crm._range("7d", None, None)
    assert (e - s).days == 7
    assert npp_crm._range("all", None, None) == (None, None)
