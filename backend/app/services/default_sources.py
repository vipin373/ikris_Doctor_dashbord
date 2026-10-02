"""Initial Google Sheet connections for Ikris Doctor Connect.

Used once to seed ``google_sheet_sources`` / ``google_sheet_tabs``. After that
the Sync Center (database) is the source of truth and Admins edit mappings there.
Tabs not listed here are still discovered automatically on every sync.
"""

DEFAULT_SOURCES = [
    {
        "name": "MSL ALL INDIA",
        "spreadsheet_id": "1Qc94AybcuQ5NbXYX-wlc8-WBi6VARsuKs5KSC_7IIbs",
        "default_department": "NPP",
        "description": "NPP doctors (Oncology / Hematology) with 1st and 20th mail outreach status.",
        "tabs": [
            {
                "tab_name": "Doctors",
                "data_kind": "doctors",
                "department_code": "NPP",
                "is_enabled": True,
                "mapping": {
                    "fields": {"specialty": "Specialty"},
                    "sub_department": {
                        "column": "Specialty",
                        "map": {"ONC": "Oncology", "HEMA": "Hematology", "BOTH": "Oncology & Hematology"},
                    },
                    "date_formats": ["%d/%m/%Y %H:%M:%S", "%d/%m/%Y"],
                    "events": [
                        {
                            "channel": "EMAIL", "event_type": "1st Mail", "campaign": "NPP 1st Mail",
                            "status_column": "1st Mail Status", "date_column": "1st Mail Date",
                            "subject_column": "Last Subject", "error_column": "Error",
                        },
                        {
                            "channel": "EMAIL", "event_type": "20th Mail", "campaign": "NPP 20th Mail",
                            "status_column": "20th Mail Status", "date_column": "20th Mail Date",
                            "error_column": "Error", "skipped_pattern": "no active campaign",
                        },
                    ],
                },
            },
            {"tab_name": "Campaigns", "data_kind": "ignore", "is_enabled": False, "mapping": {}},
        ],
    },
    {
        "name": "Doctor Email List - Rare Disease",
        "spreadsheet_id": "16YI9wxwERKlUct8p4fSqkAdk8nnX5Ue3t8Ji2n5OeuY",
        "default_department": "RARE_DISEASES",
        "description": "Rare Disease doctors (Genetics, Neuro) and the twice-monthly intro email status.",
        "tabs": [
            {
                "tab_name": "Doctor List",
                "data_kind": "doctors",
                "department_code": "RARE_DISEASES",
                "is_enabled": True,
                "mapping": {
                    "fields": {"s_no": "S.No", "specialty": "Specialization"},
                    "sub_department": {"column": "Department"},
                    "date_formats": ["%m/%d/%Y"],
                    "events": [
                        {
                            "channel": "EMAIL", "event_type": "Rare Disease intro email",
                            "campaign": "Rare Disease intro - template", "campaign_column": "Last Sent Period",
                            "status_column": "Status", "date_column": "Last Sent Date",
                        }
                    ],
                },
            },
            *[
                {"tab_name": name, "data_kind": "ignore", "is_enabled": False, "mapping": {}}
                for name in [
                    "Email Template 1", "Email Template 2", "Email Template 3", "Email Template 4",
                    "Email Template 5", "Subject Lines", "Instructions",
                ]
            ],
        ],
    },
    {
        "name": "Doctor Thank-you Automation",
        "spreadsheet_id": "1M17bwH5AZk8ZZyzGhs5oywRw-BUfH4l98CG0Esvn8Og",
        "default_department": "NPP",
        "description": "NPP doctors who received a thank-you email for a medicine.",
        "tabs": [
            {
                "tab_name": "Sheet1",
                "data_kind": "doctors",
                "department_code": "NPP",
                "is_enabled": True,
                "mapping": {
                    "events": [
                        {
                            "channel": "EMAIL", "event_type": "Thank-you email", "campaign": "Doctor thank-you",
                            "status_column": "Mail Send", "detail_column": "Medicine Name",
                            "error_column": "Column G",
                        }
                    ],
                },
            },
        ],
    },
    {
        "name": "Patient Feedback WhatsApp Automation",
        "spreadsheet_id": "1eWpuqQ5PfiVNYRjG4gBNRCYRr3uWrBmIxopHvNMZWrU",
        "default_department": "NPP",
        "description": "Patients asked for a Google review on WhatsApp after receiving their medicine.",
        "tabs": [
            {
                "tab_name": "Sheet1",
                "data_kind": "feedback",
                "department_code": "NPP",
                "is_enabled": True,
                "mapping": {
                    "division_department": {"Onco": "NPP", "Hema": "NPP", "RD": "RARE_DISEASES"},
                    "date_formats": ["%d-%m-%Y", "%m/%d/%Y"],
                },
            },
            {"tab_name": "Sheet2", "data_kind": "ignore", "is_enabled": False, "mapping": {}},
        ],
    },
]
