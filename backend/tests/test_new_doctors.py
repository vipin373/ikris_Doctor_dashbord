from app.services.new_doctors_service import map_rows, parse_sent_date, summarize

HEAD = ["Doctor Name", "Specialty", "Hospital", "City", "Email", "Status", "Sent Date",
        "Subject Used", "Error", "Follow-up", "Thread ID", "Department"]


def test_parse_sent_date_ist():
    assert parse_sent_date("13/08/2026 11:14:57") == "2026-08-13T05:44:57Z"
    assert parse_sent_date("garbage") is None
    assert parse_sent_date("") is None


def test_map_rows_cleans_and_keys():
    vals = [HEAD,
            [" Pankaj Goyal", "Onc", "RGCI", "New Delhi", "Goyal.P@x.org", "Sent", "13/08/2026 11:14:57",
             "Subj", "", "Pending", "abc", "Medical Oncology"],
            ["Dup", "Hema", "H", "Pune", "goyal.p@x.org", "Sent", "", "", "", "", "", ""],
            ["", "Onc"]]
    rows, warnings = map_rows(vals)
    assert len(rows) == 2 and not warnings
    r = rows[0]
    assert r["doctor_name"] == "Pankaj Goyal" and r["email"] == "goyal.p@x.org"
    assert r["sub_department"] == "Medical Oncology" and r["department"] == "NPP"
    assert r["sent_at"] == "2026-08-13T05:44:57Z" and r["sheet_row"] == 2
    assert rows[0]["row_key"] != rows[1]["row_key"]
    assert set(rows[0]) == set(rows[1])  # bulk insert needs identical keys
    again, _ = map_rows(vals)
    assert again[0]["row_key"] == r["row_key"]


def test_summary():
    rows, _ = map_rows([HEAD, ["A", "Onc", "", "", "a@x", "Sent", "", "", "", "Pending", "", ""],
                        ["B", "Hema", "", "", "", "Failed", "", "", "bounce", "", "", ""]])
    s = summarize(rows)
    assert s["total"] == 2 and s["sent"] == 1 and s["errors"] == 1 and s["follow_up_pending"] == 1


def test_drug_with_ingredient():
    from app.services.message_render import drug_with_ingredient
    assert drug_with_ingredient({"drug_name": "Jaypirca", "active_ingredient": "PIRTOBRUTINIB"}) == "Jaypirca (Pirtobrutinib)"
    assert drug_with_ingredient({"drug_name": "Pirtobrutinib", "active_ingredient": "pirtobrutinib"}) == "Pirtobrutinib"
    assert drug_with_ingredient({"active_ingredient": "x"}) == "x"


def test_rare_sheet_manager_and_bdm_headers():
    from app.services.mapping import HEADER_SYNONYMS
    assert "manager" in HEADER_SYNONYMS["nsm"] and "bdm name" in HEADER_SYNONYMS["bdm"]


def test_parse_reply_formats():
    from app.services.mapping import parse_reply
    fm = ["%d/%m/%Y %H:%M:%S", "%d/%m/%Y"]
    st, d, t = parse_reply("REPLIED 04/09/2026: Dear IKRIS TEAM, We are hosting...", fm)
    assert st == "Replied" and d.day == 4 and d.month == 9 and t.startswith("Dear IKRIS")
    st, d, t = parse_reply("AUTO-REPLY 19/08/2026: I'm on annual leave until 20 August.", fm)
    assert st == "Auto-reply" and d.month == 8 and t.startswith("I'm on annual leave")
    st, d, t = parse_reply("Interested, please call me", fm)
    assert st == "Replied" and d is None and t == "Interested, please call me"
    assert parse_reply("  ", fm) is None


def test_reply_column_becomes_inbound_event():
    from app.services.mapping import TabContext, map_doctor_tab
    ctx = TabContext(spreadsheet_id="s", sheet_name="Doctors", department="NPP", header_row=1, sub_department=None, specialty=None,
                     mapping={"date_formats": ["%d/%m/%Y"], "events": [
                         {"reply_column": "Email Reply", "channel": "EMAIL", "event_type": "Email reply"}]})
    res = map_doctor_tab(ctx, [["Doctor Name", "Email", "Email Reply"],
                               ["Dr A", "a@x.com", "REPLIED 04/09/2026: Yes please send details"],
                               ["Dr B", "b@x.com", ""]])
    ev = res.doctors[0].events
    assert len(ev) == 1 and ev[0]["direction"] == "INBOUND" and ev[0]["status"] == "Replied"
    assert ev[0]["detail"] == "Yes please send details" and ev[0]["occurred_at"].startswith("2026-09-04")
    assert res.doctors[1].events == []
    assert "Email Reply" not in res.doctors[0].fields.get("extra", {})
