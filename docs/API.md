# API

Base path `/api`. Every endpoint except `/api/health` and `/api/cron/sync` needs `Authorization: Bearer <Supabase JWT>`. Interactive docs: `/api/docs`.

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/health` | public | Configuration status |
| GET | `/me` | any | Current user, role, departments |
| POST | `/auth/session-event?event=login\|logout` | any | Records login / logout in the audit log |
| GET | `/doctors` | any | Directory. Query: `q, department, sub_department, specialty, category, city, bdm, nsm, has_email, has_phone, contact, data_issue, page, page_size, sort, order` |
| GET | `/doctors/facets` | any | Filter values within the caller's departments |
| GET | `/doctors/export` | any | CSV export with the same filters (permission-scoped, audited) |
| GET | `/doctors/{id}` | any | Profile, source rows (original values), timeline. 404 when outside the caller's departments |
| GET | `/dashboard/summary` | any | KPIs and chart data (RLS-scoped) |
| GET | `/feedback` | any | Patient feedback list |
| GET | `/feedback/summary` | any | Feedback analytics |
| GET | `/departments` | any | Departments visible to the caller |
| GET | `/google-sheets` | Admin | Connections and tabs |
| POST | `/google-sheets/sync` | Admin | Sync Now |
| GET | `/google-sheets/sync-history` | Admin | Last 30 syncs |
| PUT | `/google-sheets/tabs/{id}` | Admin | Tab mapping: kind, department, sub-department, gid, enabled, mapping JSON |
| GET | `/cron/sync` | cron secret | Scheduled sync (Vercel Cron) |
| GET | `/users` | Admin | Users |
| POST | `/users` | Admin | Invite user `{email, name, role}` |
| PUT | `/users/{id}` | Admin | Change role / status / name |
| GET | `/audit-logs` | Admin | Audit log |

Department enforcement: a NPP user calling `GET /api/doctors?department=RARE_DISEASES` gets **403**; without a department filter the query is limited to NPP, and RLS applies again in Postgres.

Phase 2 endpoints (`/email/*`, `/whatsapp/*`, `/communications/{doctor_id}`, `/birthdays`, `/anniversaries`, `/feedback/import`) follow the same pattern.
