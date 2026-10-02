# Database

Supabase project **IKRIS Doctor Connect** (`ttvyxtjuypqvtdsssxpo`, ap-south-1). Migrations: `supabase/migrations/`.

## Tables

| Table | Purpose |
|---|---|
| `profiles` | One row per auth user: name, email, `role` (`ADMIN` / `NPP` / `RARE_DISEASES` / null = no access), status, last login |
| `bootstrap_admins` | Emails that become Admin automatically on first sign-up (service role only) |
| `departments` | `NPP`, `RARE_DISEASES` |
| `specialties` | Department specialties, editable data (not hard-coded) |
| `doctors` | Normalised doctor model (see below) |
| `doctor_source_rows` | Every sheet row behind a doctor, with the **original values** (`raw_data`), row number, hash and `missing_from_source` flag |
| `communication_events` | Email / WhatsApp / call / note timeline; phase 1 imports history from sheet status columns |
| `patient_feedback` | Patient feedback requests and responses |
| `google_sheet_sources` | Connected spreadsheets |
| `google_sheet_tabs` | Discovered tabs: kind (doctors / feedback / ignore), department, sub-department, mapping JSON, gid, status |
| `google_sheet_sync_logs` | Every sync with counts and details |
| `audit_logs` | Login, logout, sync, export, user and permission changes |

## Doctor model

`id, department, sub_department, dedupe_key, s_no, bdm, nsm, doctor_name, qualification, specialty, category (A/B/C), institute, institute_address, city, state, country, contact_number, whatsapp_number, email, date_of_birth, date_of_anniversary, email_norm, phone_norm, name_norm, city_norm, data_issues, extra (unknown columns), source_spreadsheet_id, source_sheet_name, source_row_number, source_record_hash, last_synced_at, last_contact_at, last_contact_channel, last_contact_status, emails_sent, whatsapp_sent, created_at, updated_at, search_text (generated)`

- Original sheet values are kept as written; `*_norm` columns hold cleaned values used for filters and duplicate detection.
- `extra` keeps any column the mapping engine does not recognise, so new sheet columns never break sync.
- `unique (department, dedupe_key)`: one doctor per department and identity (email, else phone, else name + institute).

## Row Level Security

Helper functions live in the non-exposed `app_private` schema:

- `app_private.current_app_role()` — role of `auth.uid()` (active profiles only)
- `app_private.is_admin()`
- `app_private.can_access_department(dept)` — Admin: all; NPP: `NPP`; Rare Diseases: `RARE_DISEASES`

Policies:

| Table | Read | Write |
|---|---|---|
| doctors, patient_feedback, communication_events | `can_access_department(department)` | Admin (sync uses service role) |
| doctor_source_rows | via the parent doctor's department | service role |
| specialties, departments | by department | Admin |
| profiles | own row, or Admin | Admin |
| google_sheet_*, audit_logs | Admin | Admin / service role |

`doctor_facets()` and `dashboard_summary()` are `SECURITY INVOKER`, so every aggregate respects RLS.
