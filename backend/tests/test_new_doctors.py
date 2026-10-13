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
