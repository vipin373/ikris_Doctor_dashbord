# International Drug Intelligence

A module inside IKRIS Doctor Connect (sidebar → **International Drug Intelligence**) that links
international regulatory records → therapeutic area → doctors → doctor–drug mapping → NPP medicine requests.

## Data sources and terms

| Jurisdiction | Source | How it gets in | Terms |
|---|---|---|---|
| USA | openFDA Drugs@FDA bulk export (NDA/BLA, original approval) | **Sync now** (admin), ~15 s | US Government public data |
| EU (centralised) | EMA "Medicines" data file (nightly) | **Sync now** or upload the EMA Excel file | Commercial reuse allowed if EMA is acknowledged; every EU record carries "Source: European Medicines Agency (EMA)" |
| Japan | PMDA approved products / drug search | Admin verification (one by one) or `Drug_Country_Approval` CSV/Sheet import | No open bulk dataset is assumed |
| UK and national EU registers | MHRA, BfArM, ANSM, AIFA, AEMPS, CBG-MEB, FAMHP, BDA… | Same as Japan | Same as Japan |
| KEGG | — | **Not imported.** KEGG requires a commercial licence for non-academic use. KEGG IDs can be added by hand / master import once licensed. | https://www.genome.jp/kegg/legal.html |

Nothing is invented: a field the source does not state stays empty; a country without a record
shows **Not Verified**, which never means "not approved".

### Field authority
* Regulatory facts (status, dates, numbers, labels) — the official source named on each approval record.
* Drug master (names, classes, areas) — first source that states the field; admin edits win and lock the record.
* Records verified by a person (`locked`) are never overwritten by automatic imports.

## Database (Supabase, migration `0020_drug_intelligence.sql`)

| Table | Sheet tab | Notes |
|---|---|---|
| `intl_drugs` | International_Drug_Master | Permanent `Drug_ID` (IDI-000001); `match_key` = normalised active substance(s) for duplicate detection (salts, FDA biologic suffixes, USAN→INN handled) |
| `intl_drug_approvals` | Drug_Country_Approval | One row per drug + country; 8 controlled statuses; source checked, search terms, last verified, verified by |
| `intl_drug_indications` | Drug_Indications | One row per indication text per country |
| `intl_drug_history` | Drug_Regulatory_History | Written by trigger on every status/date change — never overwritten |
| `npp_drug_requests` | NPP_Drug_Requests | Pseudonymous patient reference only; visible to assigned department + Admin (RLS) |
| `doctor_drug_mappings` | — | Human-confirmed doctor ↔ medicine links; RLS limits to the user's department |
| `intl_import_runs` | — | Every import with counts and skipped rows |

`intl_import(origin, rows)` performs matching, de-duplication, lock protection and history in one database call.
`intl_drug_overview` (view) powers the searchable table and KPIs (`intl_summary`, `intl_reports`).

## Roles
* **Admin** — everything, including Sync now, uploads, edits and verification.
* **NPP / Rare Disease** — search, view approvals, compare, map their own department's doctors, create/track NPP requests, export.

## Google Sheets
Exports use the exact tab names and columns (`Export all tabs (Excel)` or one CSV per tab).
Import reads `Drug_Country_Approval` or `International_Drug_Master` from a sheet shared "anyone with the link can view".
Writing straight into the Google Sheet needs a Google service account on the server (`GOOGLE_SERVICE_ACCOUNT_JSON`) — same pending item as the doctor sheets.

## Status rules shown in the UI
* "Not Verified" = no check recorded. "No Approval Record Found" = the checked source returned nothing (does not prove no approval).
* EU centralised authorisation ≠ marketed in every EU country. UK is separate from EU.
* Approval ≠ marketing ≠ stock ≠ import eligibility ≠ patient-specific permission; requests track each separately and
  import eligibility is for the compliance team — the app draws no legal conclusion.
* Drug comparison shows regulatory facts only — no clinical equivalence or treatment recommendation.

## Test & performance report (13 Nov 2026)
* Unit tests: `backend/tests/test_drug_intel.py` (name matching/duplicates, EMA + FDA parsers, CSV validation, filters, roles, patient-reference guard). Full suite 84 passed.
* Live checks: EMA import 1,285 substances (~10 s); openFDA 2,697 substances (~13 s) — 3,093 unique medicines, 889 matched across USA+EU.
  Re-import: 0 duplicates, 0 changed, 1,285 unchanged. Locked record skipped by CSV import. NPP user blocked from imports/edits (403) and from mapping Rare doctors (RLS).
  Rare user cannot see NPP requests. Test rows were removed afterwards.
* Server-side pagination, trigram search index, debounced search, lazy detail loading.

## Deployment
Apply `supabase/migrations/0020_drug_intelligence.sql`, deploy as usual (Vercel). No new environment variables.
Run **Data Import & Sync → Sync now** for USA and EU after deployment (already done for production on 13 Nov 2026).
