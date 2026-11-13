"""The three regulators that share the FDA drug-communication pipeline.

Every feature (drug list, classification review, India/CDSCO check, KEGG, doctor
matching, templates, single/bulk campaigns, review, sending, logs) works the same
for each; only the source of drug facts and the wording differ.
"""

from __future__ import annotations

from typing import Literal

Regulator = Literal["FDA", "EMA", "PMDA"]
REGULATOR_PATTERN = "^(FDA|EMA|PMDA)$"

INFO: dict[str, dict[str, str]] = {
    "FDA": {
        "code": "FDA",
        "short": "FDA",
        "authority": "U.S. Food and Drug Administration",
        "region": "USA",
        "status_label": "FDA status",
        "approval_label": "FDA approval",
        "record_link": "Drugs@FDA",
        "label_link": "FDA label",
        "data_name": "FDA",
        "objective": "Share an FDA drug information update and offer help with availability or patient access.",
        "source_terms": "openFDA (US Government public data)",
    },
    "EMA": {
        "code": "EMA",
        "short": "EMA",
        "authority": "European Medicines Agency (EU marketing authorisation by the European Commission)",
        "region": "European Union",
        "status_label": "EMA status",
        "approval_label": "EU authorisation",
        "record_link": "EMA medicine page (EPAR)",
        "label_link": "EMA product information",
        "data_name": "EMA",
        "objective": "Share an EU (EMA) medicine information update and offer help with availability or patient access.",
        "source_terms": "Source: European Medicines Agency (EMA) — reuse permitted with acknowledgement",
    },
    "PMDA": {
        "code": "PMDA",
        "short": "PMDA",
        "authority": "Pharmaceuticals and Medical Devices Agency, Japan (approval by MHLW)",
        "region": "Japan",
        "status_label": "PMDA status",
        "approval_label": "Japan approval",
        "record_link": "PMDA list of approved products",
        "label_link": "PMDA review report",
        "data_name": "PMDA",
        "objective": "Share a Japan (PMDA) medicine information update and offer help with availability or patient access.",
        "source_terms": "Source: PMDA, List of Approved Products (English)",
    },
}


def info(regulator: str | None) -> dict[str, str]:
    return INFO.get(regulator or "FDA", INFO["FDA"])
