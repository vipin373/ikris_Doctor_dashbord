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
from app.services.mapping import TabContext, detect_kind, map_doctor_tab, map_feedback_tab, merge_doctors  # noqa: E402

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
            "doctors": [], "doctor_source_rows": [], "communication_events": [], "patient_feedback": [],
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


def test_sync_needs_admin_or_service_key(monkeypatch):
    from app.core.supabase import ServiceUnavailable
    with pytest.raises(ServiceUnavailable):
        sync_service._sync_db(None)
    with pytest.raises(ServiceUnavailable):
        sync_service._sync_db(user("NPP"))
    assert sync_service._sync_db(user("ADMIN")) is not None


_ = mapping
