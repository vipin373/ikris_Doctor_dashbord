# New Doctors (Apollo leads)

Sidebar: **New Doctors** (Admin and NPP users).

- Source: Google Sheet "IKRIS Doctor Mailer" (`1hUtB8yI_UgsLmREPCtehpXrJvirxRp_4J_lRxGv5qhg`, tab `Doctors`, gid 0),
  read through its public link. Override with `NEW_DOCTORS_SHEET_ID` / `NEW_DOCTORS_SHEET_GID`.
- Stored only in `public.new_doctors` (migration `0011_new_doctors.sql`). It is **not** registered in Google Sheets
  connections and is never merged into `doctors`, NPP/Rare pages, dashboard counts, reminders, campaigns or FDA matching.
- The table mirrors the sheet: "Sync from sheet" adds new rows, updates changed rows and removes rows deleted from the sheet.
  The daily scheduled sync also refreshes it when `SUPABASE_SERVICE_ROLE_KEY` is set.
- Columns: Doctor Name, Specialty (Onc/Hema), Hospital, City, Email, Status, Sent Date (DD/MM/YYYY HH:MM:SS, IST),
  Subject Used, Error, Follow-up, Thread ID, Department. Unknown extra columns are kept in `extra`.
- API: `GET /api/new-doctors` (rows + summary), `POST /api/new-doctors/sync`.
