# NPP Doctor CRM

NPP only (Admin and NPP users). Rare Diseases is unchanged.

## Categories: A / B / C / blank
- `doctors.category` allows only `A`, `B`, `C` or `NULL` (blank = Unassigned). No default, never inferred.
- Changes go through `set_doctor_categories(ids, category, source)` (Admin / NPP role check, one transaction,
  NPP doctors only, every change logged in `doctor_category_changes` with previous/new/source/user/time).
- Sources: MANUAL, DRAG_DROP, BULK, CSV_IMPORT, SHEET_IMPORT, API.
- Google Sheet protection (trigger `keep_manual_fields`): a blank sheet value never erases a category; a sheet value
  equal to the sheet's previous value is stale and the dashboard value wins; only a value that changed in the sheet
  since the last sync is applied (logged SHEET_IMPORT). The sync sends `category_sheet_value` for this.
- Writing categories back into Google Sheets needs a Google service account with edit access (not configured).

## Pages
- `/npp/categories` – 4 category cards, 4-column drag & drop board (keyboard "Move to…" on every card),
  multi-select with confirmation (total, current distribution, records to update), CSV/Excel import with preview
  (blank never clears unless "Clear categories for blank rows" is on), export per category, change history.
- `/npp/groups` – groups from filters (category, specialization, city, state, hospital, keyword, email/WhatsApp),
  drag doctors onto groups, add/remove, rename/delete, CSV export, email/WhatsApp a group. Groups never change categories.
- `/npp/outreach` – email / WhatsApp campaigns to categories (Unassigned excluded), groups, selected doctors or custom
  filters; recipient preview with exclusions; email sequence (1st/2nd/3rd/Follow-up/Final); confirmation; batched
  sending with progress. Each message stores `category_at_send`. WhatsApp: approved doctor-only templates, or free text
  (24-hour window only).
- `/npp/inbox` – Email replies / WhatsApp replies tabs, read/unread, filters, full conversation per doctor.
- `/npp/analytics` – current category performance (rates), historical (category at send), distributions, CSV export.
- Doctor list (NPP): Unassigned filter, Select all matching doctors, Set category, Add to group, Email/WhatsApp.
- Doctor profile (NPP): category panel with history; engagement uses real reply data.

## WhatsApp replies
Cunnekt webhook `/api/webhooks/cunnekt?token=…` now also stores incoming messages as replies
(`record_whatsapp_inbound`, matched by the last 10 digits of the WhatsApp/phone number) and updates campaign
message delivery status (`outreach_record_status`). The webhook URL must be set in Cunnekt.

## Not available yet (needs external setup)
- Email sending: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM on the server.
- Email reply capture from the mailbox (IMAP/Gmail API); today replies come from the MSL sheet columns.
- WhatsApp voice notes / documents (Cunnekt media API), email attachments, scheduled sending.
- Zone (not in the NPP sheets).
