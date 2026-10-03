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

## Email templates

Tabs with data kind **templates** are read on every sync into `email_templates` and shown on the **Email Templates** page. Layouts (`mapping.layout`):

| Layout | Used for | Mapping keys |
|---|---|---|
| `cells` | `Email Template 1…5` (subject in B1, HTML body in B2) | `subject_cell`, `body_cell`, `notes_cells` |
| `rows` | MSL ALL INDIA `Campaigns` (one template per row) | `columns`: campaign, specialty, subject, body, active |
| `subject_list` | `Subject Lines` rotation | `column`, `start_row`, `info_cells` |

Template text is stored exactly as written (HTML, line breaks, leading spaces).

### Editing templates from the dashboard

Edits are written straight into the Google Sheet, so the existing Apps Script automations pick them up on their next run. The dashboard writes through a small Apps Script web app added to each spreadsheet (the "editing bridge"):

1. Admin → Google Sheets Sync Center → **Edit templates from the dashboard → Set up**.
2. Copy the generated script into the spreadsheet (Extensions → Apps Script → new file), save.
3. Deploy → New deployment → Web app, Execute as **Me**, access **Anyone**; copy the `/exec` URL.
4. Paste the URL and press **Test and connect**.

The script contains a random token and the list of template tabs; it rejects requests without the token and refuses any other tab. Disconnect removes the token from the app; also delete the deployment in Apps Script.

Who can edit: Admins, and NPP / Rare Disease users for their own department's templates. Every change is audit-logged.

## Birthdays and anniversaries

Add columns named **Date of Birth** and **Date of Anniversary** to any doctor sheet; they are read on the next sync. Accepted forms include `15-Aug-1975`, `15/08/1975`, `1975-08-15` and year-less `15-Aug`. Dates can also be entered on a doctor's profile; those are kept across syncs unless the sheet provides a value.
