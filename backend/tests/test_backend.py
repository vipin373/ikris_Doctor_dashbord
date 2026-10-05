"""Tests for the mapping engine, search parsing, permissions and the sync
service. Uses fictional data only."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import doctors as doctors_api  # noqa: E402
from app.core import security  # noqa: E402
from app.core.security import CurrentUser  # noqa: E402
from app.main import app  # noqa: E402
from app.services import mapping, sync_service  # noqa: E402
from app.services import sheet_bridge  # noqa: E402
from app.services.mapping import (  # noqa: E402
    TabContext, a1_to_index, detect_kind, map_doctor_tab, map_feedback_tab, map_template_tab, merge_doctors, parse_date,
)

NPP_SHEET = [
    ["Doctor Name", "Specialty", "Hospital", "City", "Email", "1st Mail Status", "1st Mail Date", "20th Mail Status", "Error"],
    ["Dr. Asha Rao", "ONC", "Demo Cancer Centre", "Delhi", "asha.rao@example.com", "Sent - ONC", "17/08/2026 11:32:50", "ERROR", "Error: No ACTIVE campaign found"],
    ["Dr Vikram Sen", "HEMA", "City Hospital", "delhi", "VIKRAM@EXAMPLE.COM, ", "Sent - HEMA", "18/08/2026 10:00:00", "", ""],
    ["Dr. Bad Email", "ONC", "City Hospital", "Mumbai", "bad.example.com", "ERROR", "", "", "Exception: Invalid email"],
    ["", "", "", "", "", "", "", "", ""],
]
NPP_MAPPING = {
    "fields": {"specialty": "Specialty"},
    "sub_department": {"column": "Specialty", "map": {"ONC": "Oncology", "HEMA": "Hematology"}},
    "date_formats": ["%d/%m/%Y %H:%M:%S"],
    "events": [
        {"event_type": "1st Mail", "status_column": "1st Mail Status", "date_column": "1st Mail Date", "error_column": "Error"},
        {"event_type": "20th Mail", "status_column": "20th Mail Status", "error_column": "Error", "skipped_pattern": "no active campaign"},
    ],
}
RD_SHEET = [
    ["S.No.", "BDM", "NSM", "Doctor's Name", "Qualification", "Specialty", "Category (A/B/C)", "Institute",
     "Institute Address", "City", "State", "Contact Number", "Email ID", "Date of Birth", "Date of Anniversary", "Hobby"],
    ["1", "Rahul", "Md Shakib", "Dr. Meera Iyer", "MD, DM", "Geneticist", "A", "Demo Institute", "Ring Road",
     "Delhi", "Delhi", "+91 98100 00001", "meera@example.com", "03/10/1980", "", "Chess"],
    ["2", "Rahul", "Md Shakib", "Dr. Old Phone", "MD", "Nephro", "c", "Demo Institute", "", "Pune", "MH",
     "9.90E+09", "", "", "", ""],
]


def ctx(dept="NPP", mapping_=None, name="Doctors"):
    return TabContext("sheet-1", name, dept, None, None, mapping_ or {})


def test_detect_kind():
    assert detect_kind(NPP_SHEET[0]) == "doctors"
    assert detect_kind(RD_SHEET[0]) == "doctors"
    assert detect_kind(["Date", "Patient Name", "Phone Number", "Medicine"]) == "feedback"
    assert detect_kind(["Default Subject", "Body (HTML)"]) == "ignore"


def test_npp_mapping_events_and_normalisation():
    res = map_doctor_tab(ctx(mapping_=NPP_MAPPING), NPP_SHEET)
    assert res.skipped_blank == 1
    asha, vikram, bad = res.doctors
    assert asha.fields["sub_department"] == "Oncology" and vikram.fields["sub_department"] == "Hematology"
    assert asha.dedupe_key == "e:asha.rao@example.com"
    assert vikram.fields["email_norm"] == "vikram@example.com"
    assert vikram.fields["city_norm"] == "delhi"
    assert bad.fields["email_norm"] is None and "email_invalid" in bad.issues
    assert bad.dedupe_key.startswith("n:bad email|")
    first, twentieth = asha.events
    assert first["status"] == "Sent" and first["occurred_at"].startswith("2026-08-17T11:32:50")
    assert twentieth["status"] == "Not sent"
    assert bad.events[0]["status"] == "Failed" and "Invalid email" in bad.events[0]["detail"]
    # original values preserved
    assert asha.raw["Specialty"] == "ONC"


def test_rare_disease_master_columns_and_extra():
    res = map_doctor_tab(ctx("RARE_DISEASES", {"date_formats": ["%d/%m/%Y"]}, "Geneticist"), RD_SHEET)
    meera, old = res.doctors
    f = meera.fields
    assert (f["bdm"], f["nsm"], f["qualification"], f["category"]) == ("Rahul", "Md Shakib", "MD, DM", "A")
    assert f["institute_address"] == "Ring Road" and f["state"] == "Delhi"
    assert f["phone_norm"] == "9810000001" and f["date_of_birth"] == "1980-10-03"
    assert f["extra"] == {"Hobby": "Chess"}          # unknown future column kept
    assert old.fields["category"] == "C"
    assert "phone_lost_in_sheet" in old.issues and old.fields["phone_norm"] is None


def test_merge_and_duplicate_detection():
    a = map_doctor_tab(ctx(mapping_=NPP_MAPPING), NPP_SHEET)
    thank_you = [["Medicine Name", "Doctors Name", "Doctors Email ID", "Doctors Contact details", "Hospital", "Mail Send"],
                 ["Demo-mab", "Dr. Asha Rao", "asha.rao@example.com", "9810000002", "Demo Cancer Centre", "Yes"],
                 ["Demo-mab", "Dr. Asha Rao", "asha.other@example.com", "", "Demo Cancer Centre", "Yes"]]
    b = map_doctor_tab(ctx(name="Sheet1", mapping_={"events": [{"event_type": "Thank-you", "status_column": "Mail Send"}]}), thank_you)
    merged, dupes = merge_doctors([(ctx(name="Doctors"), a), (ctx(name="Sheet1"), b)])
    assert dupes == 1
    asha = next(m for m in merged if m.dedupe_key == "e:asha.rao@example.com")
    assert asha.fields["contact_number"] == "9810000002"   # filled from the second sheet
    assert len(asha.rows) == 2
    assert "possible_duplicate" in asha.issues               # same name, other email


def test_feedback_mapping():
    sheet = [["Date", "Patient Name", "Country Code", "Phone Number", "Medicine", "WhatsApp Status", "Sent Date", "Division"],
             ["21-09-2026", "Demo Patient", "91", "9810000003", "Demo 50 mg", "Sent", "9/22/2026", "RD"],
             ["31-07=2026", "Second Patient", "91", "76959902901", "Demo", "Duplicate", "", "Onco"]]
    res = map_feedback_tab(TabContext("fb", "Sheet1", "NPP", None, None, {
        "division_department": {"RD": "RARE_DISEASES", "Onco": "NPP"}, "date_formats": ["%d-%m-%Y", "%m/%d/%Y"]}), sheet)
    one, two = res.feedback
    assert one.fields["department"] == "RARE_DISEASES" and one.fields["sent_date"] == "2026-09-22"
    assert two.fields["department"] == "NPP"
    assert "request_date_invalid" in two.issues and "phone_invalid" in two.issues


def test_search_terms():
    assert doctors_api.search_terms("Oncologist Delhi") == ["onc", "delhi"]
    assert doctors_api.search_terms("Geneticist Delhi Category A") == ["genetic", "delhi", "category a"]
    assert doctors_api.search_terms("Dr Amit, Apollo") == ["amit", "apollo"]
    assert doctors_api.search_terms("hematologist") == ["hemat"]


# ----------------------------------------------------------------------------- permissions

def user(role):
    return CurrentUser(id="u1", email="u@example.com", name="U", role=role, token="t")


def test_department_rules():
    assert user("ADMIN").ensure_department(None) == ["NPP", "RARE_DISEASES"]
    assert user("NPP").ensure_department(None) == ["NPP"]
    assert user("RARE_DISEASES").ensure_department("RARE_DISEASES") == ["RARE_DISEASES"]
    with pytest.raises(HTTPException) as e:
        user("NPP").ensure_department("RARE_DISEASES")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        user("RARE_DISEASES").ensure_department("NPP")


class FakeDB:
    calls: list = []

    def __init__(self, *a, **k):
        pass

    async def select(self, table, params, count=False, offset=None, limit=None):
        FakeDB.calls.append((table, list(params.items()) if isinstance(params, dict) else list(params)))
        return [], 0

    async def rpc(self, fn, payload=None):
        return {}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(CurrentUser, "db", lambda self: FakeDB())
    FakeDB.calls = []
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("role,query,expected", [
    ("NPP", "", 200), ("NPP", "?department=RARE_DISEASES", 403),
    ("RARE_DISEASES", "?department=NPP", 403), ("RARE_DISEASES", "", 200),
    ("ADMIN", "?department=NPP", 200), ("ADMIN", "?department=RARE_DISEASES", 200),
])
def test_api_department_isolation(client, role, query, expected):
    app.dependency_overrides[security.get_current_user] = lambda: user(role)
    resp = client.get(f"/api/doctors{query}")
    assert resp.status_code == expected
    if expected == 200:
        dept_filter = dict(FakeDB.calls[-1][1])["department"]
        assert dept_filter == ("in.(NPP,RARE_DISEASES)" if role == "ADMIN" and not query else f"in.({query.split('=')[1] if query else role})")


def test_admin_only_endpoints(client):
    app.dependency_overrides[security.get_current_user] = lambda: user("NPP")
    for path in ("/api/users", "/api/google-sheets", "/api/audit-logs", "/api/google-sheets/sync-history"):
        assert client.get(path).status_code == 403
    assert client.post("/api/google-sheets/sync").status_code == 403


def test_unauthenticated_requests_rejected():
    c = TestClient(app)
    for path in ("/api/doctors", "/api/dashboard/summary", "/api/feedback", "/api/me"):
        assert c.get(path).status_code == 401


def test_cron_requires_secret(monkeypatch):
    c = TestClient(app)
    assert c.get("/api/cron/sync").status_code == 401
    assert c.get("/api/cron/sync", headers={"Authorization": "Bearer wrong"}).status_code == 401


# ----------------------------------------------------------------------------- sync service

class MemoryDB:
    """Tiny in-memory stand-in for PostgREST used by the sync tests."""

    def __init__(self):
        self.tables = {
            "google_sheet_sources": [{"id": 1, "name": "Demo", "spreadsheet_id": "sheet-1", "default_department": "NPP", "is_active": True}],
            "google_sheet_tabs": [{"id": 10, "source_id": 1, "tab_name": "Doctors", "sheet_gid": 0, "data_kind": "doctors",
                                   "department_code": "NPP", "sub_department": None, "specialty": None,
                                   "mapping": NPP_MAPPING, "is_enabled": True, "headers": []}],
            "doctors": [], "doctor_source_rows": [], "communication_events": [], "patient_feedback": [], "email_templates": [],
            "google_sheet_sync_logs": [],
        }
        self.seq = 100

    async def select_all(self, table, params, page=1000):
        return [dict(r) for r in self.tables[table]]

    async def insert(self, table, rows, on_conflict=None, resolution=None, returning=None):
        rows = rows if isinstance(rows, list) else [rows]
        out = []
        keys = on_conflict.split(",") if on_conflict else None
        for row in rows:
            existing = next((r for r in self.tables[table] if keys and all(r.get(k) == row.get(k) for k in keys)), None)
            if existing:
                if resolution == "merge-duplicates":
                    existing.update(row)
                    out.append(existing)
                continue
            self.seq += 1
            new = {"id": self.seq, **row}
            self.tables[table].append(new)
            out.append(new)
        return out if returning else []

    async def delete(self, table, filters):
        def keep(r):
            for col, cond in filters:
                op, _, val = cond.partition(".")
                if op == "eq" and str(r.get(col)) != val:
                    return True
                if op == "not" and val.startswith("in.("):
                    values = [v.strip('"') for v in val[4:-1].split(",")]
                    if r.get(col) in values:
                        return True
            return False
        self.tables[table] = [r for r in self.tables[table] if keep(r)]

    async def update(self, table, filters, data, returning=None):
        hit = []
        for r in self.tables[table]:
            ok = True
            for col, cond in filters:
                op, _, val = cond.partition(".")
                if op == "eq" and str(r.get(col)).lower() != val.lower():
                    ok = False
                if op == "lt" and not (str(r.get(col)) < val):
                    ok = False
            if ok:
                r.update(data)
                hit.append(r)
        return hit if returning else []


def test_sync_is_incremental_and_never_deletes(monkeypatch):
    db = MemoryDB()
    sheet = [list(r) for r in NPP_SHEET]
    monkeypatch.setattr(sync_service, "_sync_db", lambda user: db)

    async def fake_read(*a, **k):
        return sheet

    async def no_discovery(*a, **k):
        return []
    monkeypatch.setattr(sync_service, "read_tab", fake_read)
    monkeypatch.setattr(sync_service, "_discover", no_discovery)

    first = asyncio.run(sync_service.run_sync(None))
    assert first["doctors"]["new"] == 3 and first["status"] == "success"
    assert len(db.tables["communication_events"]) == first["new_events"] == 4

    second = asyncio.run(sync_service.run_sync(None))
    assert second["doctors"] == {"new": 0, "updated": 0, "total_in_sheets": 3}
    assert second["unchanged"] == 3 and second["new_events"] == 0

    sheet[1][2] = "Renamed Cancer Centre"     # change a value
    del sheet[3]                              # remove a row from the sheet
    third = asyncio.run(sync_service.run_sync(None))
    assert third["doctors"]["updated"] == 1
    assert len(db.tables["doctors"]) == 3      # nothing deleted
    assert third["flagged_missing"] >= 1


TEMPLATE_CELLS = [["Default Subject", "Hello {{DoctorName}}"], ["Body (HTML)", "<p>Dear {{DoctorName}},</p>\n<p>Line</p>"], [],
                  ["Merge tags", "{{DoctorName}}"], ["Note", "Sent on the 1st"]]
CAMPAIGNS = [["Campaign", "Specialty", "Subject", "Email Body", "Active"],
             ["1st Mail", "HEMA", "Intro", "<div>Hi</div>", "yes"],
             ["20th Mail", "ONC", "Follow-up", "Dear Dr. {{Doctor Name}},", "no"]]
SUBJECTS = [["Subject Lines (edit freely)", "", "Next Index (auto-managed)", "2"], ["First"], [" Second with space"], [""], ["Fourth"]]


def test_template_layouts():
    cells = map_template_tab(TabContext("s", "Email Template 1", "RARE_DISEASES", None, None,
                                        {"layout": "cells", "subject_cell": "B1", "body_cell": "B2", "notes_cells": ["B4", "B5"]}), TEMPLATE_CELLS)
    assert cells[0]["subject"] == "Hello {{DoctorName}}"
    assert cells[0]["body_html"].count("\n") == 1               # line breaks kept
    assert cells[0]["notes"] == "Merge tags: {{DoctorName}}\nNote: Sent on the 1st"
    empty = map_template_tab(TabContext("s", "Email Template 3", "RARE_DISEASES", None, None,
                                        {"layout": "cells", "subject_cell": "B1", "body_cell": "B2"}), [])
    assert empty[0]["subject"] is None and empty[0]["name"] == "Email Template 3"

    rows = map_template_tab(TabContext("s", "Campaigns", "NPP", None, None, {"layout": "rows", "columns": {
        "campaign": "Campaign", "specialty": "Specialty", "subject": "Subject", "body": "Email Body", "active": "Active"}}), CAMPAIGNS)
    assert [r["is_active"] for r in rows] == [True, False]
    assert rows[1]["body_cell"] == "D3" and rows[1]["active_cell"] == "E3" and rows[1]["name"] == "20th Mail · ONC"

    subjects = map_template_tab(TabContext("s", "Subject Lines", "RARE_DISEASES", None, None, {
        "layout": "subject_list", "column": "A", "start_row": 2, "info_cells": {"Next index": "D1"}}), SUBJECTS)
    assert [(t["subject"], t["subject_cell"]) for t in subjects] == [("First", "A2"), (" Second with space", "A3"), ("Fourth", "A5")]
    assert subjects[0]["notes"] == "Next index: 2"
    assert a1_to_index("AB12") == (11, 27)


def test_birthday_formats():
    sheet = [["Doctor Name", "Email", "Date of Birth", "Date of Anniversary"],
             ["Dr A", "a@example.com", "15-Aug", "03/10/1990"],
             ["Dr B", "b@example.com", "29 Feb", "not a date"]]
    res = map_doctor_tab(ctx("RARE_DISEASES", {"date_formats": ["%m/%d/%Y"]}), sheet)
    a, b = res.doctors
    assert a.fields["date_of_birth"] == "1904-08-15"            # year-less birthday
    assert a.fields["date_of_anniversary"] == "1990-03-10"      # tab format (US) first
    assert b.fields["date_of_birth"] == "1904-02-29"
    assert "date_of_anniversary_invalid" in b.issues
    assert parse_date("21-09-2026", ["%d-%m-%Y"]).day == 21


def test_birthday_sheet_forms_and_multi_email():
    sheet = [["Doctor Name", "Email", "DOB", "Date of Anniversary", "Status "],
             ["VIPIN ", "a@example.com", "10 - Aug", "", "done"],
             ["Abhay", "b@example.com,infoexample.net", "11- Aug", "1st May", ""],
             ["Jyoti", "c@example.com/d@example.com", "23 Dec", "24-Jine", ""],
             ["Vashith", "x@example.com", "17-July", "", ""],
             ["Bad", "Devavrat. arya@example.com", "", "", ""]]
    m = {"date_formats": ["%d-%b"], "events": [{"event_type": "Birthday email", "status_column": "Status"}]}
    res = map_doctor_tab(ctx("NPP", m, "Sheet1"), sheet)
    vipin, abhay, jyoti, vashith, bad = res.doctors
    assert vipin.fields["date_of_birth"] == "1904-08-10" and vipin.events[0]["status"] == "Sent"
    assert abhay.fields["date_of_birth"] == "1904-08-11" and abhay.fields["date_of_anniversary"] == "1904-05-01"
    assert abhay.dedupe_key == "e:b@example.com" and "email_multiple" in abhay.issues
    assert jyoti.dedupe_key == "e:c@example.com" and jyoti.fields["date_of_birth"] == "1904-12-23"
    assert "date_of_anniversary_invalid" in jyoti.issues            # "24-Jine" typo
    assert vashith.fields["date_of_birth"] == "1904-07-17"
    assert bad.fields["email_norm"] is None and "email_invalid" in bad.issues


def test_birthday_master_sheet():
    sheet = [["Sr No", "Doctor Name", "Email", "Country Code", "WhatsApp Number", "Birthday (DD/MM)", "Work Anniversary (DD/MM)",
              "Active", "Birthday Email Sent On", "Birthday WhatsApp Sent On", "Anniversary Email Sent On", "Anniversary WhatsApp Sent On", "Remarks"],
             ["1", "Boman", "b@example.com", "91", "9820000001", "01/09", "16/11", "Yes", "2026-09-01", "2026-09-01"],
             ["52", "Shilpi", "", "91", "8826990915", "14/08", "14/08", "Yes", "", "2026-08-14", "", "", "Internal/test contact"]]
    events = [
        {"channel": "EMAIL", "event_type": "Birthday email", "date_column": "Birthday Email Sent On", "status_from_date": True},
        {"channel": "WHATSAPP", "event_type": "Birthday WhatsApp", "date_column": "Birthday WhatsApp Sent On", "status_from_date": True},
        {"channel": "EMAIL", "event_type": "Anniversary email", "date_column": "Anniversary Email Sent On", "status_from_date": True},
    ]
    m = {"fields": {"date_of_birth": "Birthday (DD/MM)", "date_of_anniversary": "Work Anniversary (DD/MM)"},
         "date_formats": ["%d/%m", "%Y-%m-%d"], "events": events}
    boman, shilpi = map_doctor_tab(ctx("NPP", m, "Doctors"), sheet).doctors
    assert boman.fields["date_of_birth"] == "1904-09-01" and boman.fields["date_of_anniversary"] == "1904-11-16"
    assert boman.fields["whatsapp_number"] == "9820000001"
    assert [(e["channel"], e["occurred_at"][:10]) for e in boman.events] == [("EMAIL", "2026-09-01"), ("WHATSAPP", "2026-09-01")]
    assert shilpi.dedupe_key == "p:8826990915"                 # no email: WhatsApp number identifies
    assert [e["event_type"] for e in shilpi.events] == ["Birthday WhatsApp"]
    assert shilpi.fields["extra"]["Remarks"] == "Internal/test contact"


def test_bridge_script_and_url():
    script = sheet_bridge.render_script("sheet-id", "Demo", "tok", ["Email Template 1", "Subject Lines"])
    assert "var IKRIS_TOKEN = 'tok';" in script and "['Email Template 1', 'Subject Lines']" in script
    assert sheet_bridge.valid_url("https://script.google.com/macros/s/AKfycbx-12_ab/exec")
    assert not sheet_bridge.valid_url("https://evil.example.com/macros/s/x/exec")
    with pytest.raises(sheet_bridge.BridgeNotConnected):
        asyncio.run(sheet_bridge.update_cells({"bridge_url": None, "bridge_token": "t"}, []))


def test_template_and_calendar_endpoints_need_login():
    c = TestClient(app)
    for path in ("/api/templates", "/api/calendar?month=2026-10", "/api/calendar/upcoming"):
        assert c.get(path).status_code == 401


def test_schedule_is_admin_only(client):
    app.dependency_overrides[security.get_current_user] = lambda: user("NPP")
    assert client.put("/api/calendar/schedule", json=[]).status_code == 403
    assert client.get("/api/google-sheets/sources/1/editing").status_code == 403


def test_template_rejects_forbidden_department(client):
    app.dependency_overrides[security.get_current_user] = lambda: user("NPP")
    assert client.get("/api/templates?department=RARE_DISEASES").status_code == 403


def test_sync_templates_mirror_sheet(monkeypatch):
    db = MemoryDB()
    db.tables["google_sheet_tabs"].append({
        "id": 11, "source_id": 1, "tab_name": "Subject Lines", "sheet_gid": 5, "data_kind": "templates",
        "department_code": "NPP", "sub_department": None, "specialty": None, "is_enabled": True, "headers": [],
        "mapping": {"layout": "subject_list", "column": "A", "start_row": 2},
    })
    sheets = {"Doctors": [list(r) for r in NPP_SHEET], "Subject Lines": [list(r) for r in SUBJECTS]}

    async def fake_read(spreadsheet_id, tab_name, gid, mode):
        return sheets[tab_name]

    async def no_discovery(*a, **k):
        return []
    monkeypatch.setattr(sync_service, "_sync_db", lambda user: db)
    monkeypatch.setattr(sync_service, "read_tab", fake_read)
    monkeypatch.setattr(sync_service, "_discover", no_discovery)

    first = asyncio.run(sync_service.run_sync(None))
    assert first["templates"] == 3 and len(db.tables["email_templates"]) == 3
    sheets["Subject Lines"] = [SUBJECTS[0], ["First"], ["Fourth"]]      # one line removed in the sheet
    asyncio.run(sync_service.run_sync(None))
    assert sorted(t["subject"] for t in db.tables["email_templates"]) == ["First", "Fourth"]


def test_sync_needs_admin_or_service_key(monkeypatch):
    from app.core.supabase import ServiceUnavailable
    with pytest.raises(ServiceUnavailable):
        sync_service._sync_db(None)
    with pytest.raises(ServiceUnavailable):
        sync_service._sync_db(user("NPP"))
    assert sync_service._sync_db(user("ADMIN")) is not None


_ = mapping
