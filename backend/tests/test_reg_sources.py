import io

import openpyxl

from app.services import reg_sources as rs
from app.services.regulators import info


def _ema(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    header = ["Category", "Name of medicine", "EMA product number", "Medicine status", "International non-proprietary name (INN) / common name",
              "Active substance", "Therapeutic indication", "Orphan medicine", "Conditional approval", "Marketing authorisation date",
              "Marketing authorisation developer / applicant / holder", "Medicine URL", "Generic", "Biosimilar"]
    ws.append(header)
    for r in rows:
        ws.append([r.get(h) for h in header])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_ema_rows_only_authorised_human():
    rows, _ = rs.ema_rows(_ema([
        {"Category": "Human", "Name of medicine": "Glivec", "EMA product number": "EMEA/H/C/000406", "Medicine status": "Authorised",
         "International non-proprietary name (INN) / common name": "imatinib", "Therapeutic indication": "Chronic myeloid leukaemia",
         "Orphan medicine": "No", "Marketing authorisation date": "07/11/2001", "Medicine URL": "https://www.ema.europa.eu/x"},
        {"Category": "Human", "Name of medicine": "Gone", "EMA product number": "EMEA/H/C/1", "Medicine status": "Withdrawn"},
        {"Category": "Veterinary", "Name of medicine": "Vet", "EMA product number": "EMEA/V/C/1", "Medicine status": "Authorised"},
    ]))
    assert len(rows) == 1
    r = rows[0]
    assert r["regulator"] == "EMA" and r["application_number"] == "EMEA/H/C/000406" and r["approval_date"] == "2001-11-07"
    assert r["fda_status"] == "Authorised" and r["orphan"] is False and r["record_hash"]
    assert "ONCOLOGY" in r["classification"]["therapeutic_areas"] or "HEMATOLOGY" in r["classification"]["therapeutic_areas"]


def test_pmda_brand_split_and_dates():
    assert rs._split_brand("48\nEmtriva Capsules 200mg\n(Japan Tobacco Inc.)", True) == ("48", "Emtriva Capsules 200mg", "Japan Tobacco Inc.")
    assert rs._split_brand("Feron\n(Toray Industries, Inc.)", False) == (None, "Feron", "Toray Industries, Inc.")
    assert rs._dedouble("((TTaakkeeddaa") == "(Takeda"
    assert rs._d("May 19, 2025") == "2025-05-19" and rs._d("20-Apr-06") == "2006-04-20" and rs._d("Oct. 19,\n2007") == "2007-10-19"
    assert rs._d("not a date") is None


def test_regulator_info():
    assert info("EMA")["short"] == "EMA" and info("PMDA")["region"] == "Japan" and info(None)["code"] == "FDA"
