# Google Sheets integration

## Access modes

| Mode | How | Tab discovery |
|---|---|---|
| Service account (recommended) | Google Sheets API v4, sheet shared with the service account | Yes |
| Public link | CSV export of a sheet shared as "Anyone with the link" (`mapping.access_mode = "public_link"`, needs the tab gid) | No |

## Tab mapping

Each tab in **Google Sheets Sync Center** has: data kind (`doctors`, `feedback`, `ignore`), department, default sub-department, gid, enabled flag and a mapping JSON. The tab name never decides permissions; the department does.

Mapping JSON (all keys optional):

```jsonc
{
  "access_mode": "public_link",               // omit to use the service account
  "header_row": 1,
  "fields": { "specialty": "Specialization" }, // override auto-detected columns; false = ignore field
  "department": { "column": "Dept", "map": { "Onco": "NPP", "RD": "RARE_DISEASES" } },
  "sub_department": { "column": "Specialty", "map": { "ONC": "Oncology", "HEMA": "Hematology" } },
  "date_formats": ["%d/%m/%Y %H:%M:%S", "%m/%d/%Y"],
  "events": [{
    "channel": "EMAIL", "event_type": "1st Mail", "campaign": "NPP 1st Mail",
    "status_column": "1st Mail Status", "date_column": "1st Mail Date",
    "subject_column": "Last Subject", "error_column": "Error",
    "detail_column": "Medicine Name", "campaign_column": "Last Sent Period",
    "skipped_pattern": "no active campaign"
  }],
  "division_department": { "Onco": "NPP", "RD": "RARE_DISEASES" }   // feedback tabs
}
```

## Recognised columns (case-insensitive)

S.No. · BDM · NSM · Doctor's Name / Doctor Name / Doctors Name · Qualification · Specialty / Specialization · Category (A/B/C) · Institute / Hospital / Hospital Name · Institute Address / Address · City · State · Country · Contact Number / Phone / Doctors Contact details · WhatsApp Number · Email ID / Email / Doctors Email ID · Date of Birth · Date of Anniversary.

Any other column is stored in `doctors.extra` and shown on the profile, so new columns never break sync.

## Sync rules

- **Identity:** email (valid) → phone (valid) → name + institute. Rows with the same identity in the same department are merged; the first non-empty value wins per field.
- **Change detection:** a hash of each merged record; unchanged doctors are not rewritten.
- **Never destructive:** rows missing from a sheet are flagged `missing_from_source`; nothing is deleted.
- **Data quality flags:** invalid email, phone lost to scientific notation (`9.90E+09`), invalid phone, possible duplicate, test record, unreadable dates.
- **Schedule:** daily via Vercel Cron (`vercel.json`), plus Sync Now.

## Adding the NPP / Rare Disease master sheets

1. Insert a row in `google_sheet_sources` (name, spreadsheet id, default department) or ask Claude to add it.
2. With a service account configured, press Sync Now: every tab (Geneticist, Nephro, Neuro, Hepato, …) is discovered, recognised as doctors, mapped to the department and the tab name becomes the sub-department.
3. Without a service account, add each tab with its gid in the Sync Center.
