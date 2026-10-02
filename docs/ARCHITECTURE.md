# Architecture

## Components

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript strict, Tailwind, TanStack Query, Recharts, Radix | UI, session handling, role-aware navigation |
| Backend | FastAPI (Python 3.12) as a Vercel serverless function at `/api/*` | Business logic, authorisation, Google Sheets sync, exports, audit logging |
| Auth | Supabase Auth | Email + password, password reset, invitations, JWT sessions |
| Database | Supabase PostgreSQL | Primary store; Row Level Security on every table |
| External source | Google Sheets | Operational doctor lists, read one way |

The frontend never reads Google Sheets. It talks only to FastAPI, which talks to Supabase.

## Request flow

1. The browser signs in with Supabase Auth and gets a JWT.
2. Every API call sends `Authorization: Bearer <jwt>`.
3. FastAPI validates the token with Supabase Auth and loads the caller's profile **using the caller's own token** (so the role comes from the same RLS-protected row the database trusts).
4. FastAPI checks the department (`NPP`, `RARE_DISEASES`) and rejects forbidden requests with 403.
5. Queries run against PostgREST with the caller's JWT, so Postgres RLS filters every row a second time.
6. Only server-side jobs (sync, invitations, audit writes) use the service role key.

## Google Sheet synchronisation

```
Sync Now / Vercel Cron
  └─ read connections (google_sheet_sources, google_sheet_tabs)
  └─ discover new tabs (service-account mode)
  └─ read each enabled tab (Sheets API or public CSV export)
  └─ mapping engine  → normalised doctor / feedback records (pure Python, tested)
  └─ merge rows describing the same doctor (email > phone > name+institute)
  └─ compare record hash → NEW / UPDATED / UNCHANGED
  └─ upsert doctors, store every original row in doctor_source_rows
  └─ upsert communication events from status columns
  └─ flag rows missing from the sheet (never delete)
  └─ write sync log, tab status, audit log
```

## Frontend structure

```
src/app/login, forgot-password, reset-password
src/app/(app)/dashboard
src/app/(app)/doctors, doctors/[id]
src/app/(app)/npp, npp/[sub]
src/app/(app)/rare-diseases, rare-diseases/[sub]
src/app/(app)/feedback
src/app/(app)/google-sheets      (Admin)
src/app/(app)/users              (Admin)
src/app/(app)/audit-logs         (Admin)
src/components/app-shell.tsx     sidebar per role, global grouped search, user menu
src/components/doctors/          directory table, department views
src/components/ui/               design-system primitives
src/lib/                         API client, Supabase client, types, formatting
```

## Backend structure

```
backend/app/main.py              app, CORS, rate limiting, error handlers
backend/app/core/config.py       environment settings
backend/app/core/security.py     JWT validation, roles, department checks, limiter
backend/app/core/supabase.py     PostgREST / Auth client (user or service mode)
backend/app/api/doctors.py       directory, search, facets, export, profile
backend/app/api/core.py          me, session events, dashboard, feedback, users, audit logs
backend/app/api/google_sheets.py connections, Sync Now, cron sync, tab mapping
backend/app/services/mapping.py  mapping engine (pure)
backend/app/services/sync_service.py
backend/app/services/google_sheets_service.py
backend/app/services/audit.py
```

## Phase plan

Phases 1–9 (architecture, database, RLS, auth, sync, directory, profile, permissions, dashboard) plus patient feedback, export and audit logs are in this release. Phase 2 adds Email and WhatsApp providers, two-way communication, campaigns, audiences, birthdays/anniversaries, follow-ups and Excel import.
