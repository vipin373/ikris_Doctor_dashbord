# IKRIS Doctor Connect

**Ikris Pharma Network — Doctor Relationship & Outreach Management Platform**

One place to find, segment and track every doctor Ikris works with, across **NPP** (Oncology, Hematology) and **Rare Diseases** (Geneticist, Neuro, Nephro, … any specialty tab). Google Sheets remain the team's working source; the platform synchronises them into Supabase and adds search, profiles, outreach history, patient feedback, role-based access and audit logs.

```
Google Sheets ──► Sync service (FastAPI) ──► Supabase PostgreSQL (+ RLS) ──► Next.js dashboard
                                                                               │
                                              Email / WhatsApp providers ◄─────┘ (phase 2)
```

## What phase 1 includes

| Area | Status |
|---|---|
| Supabase schema, Row Level Security, three roles (Admin / NPP / Rare Diseases) | Done |
| Supabase Auth: login, logout, forgot / reset password, invitations | Done |
| Google Sheets Sync Center: mapping engine, Sync Now, daily scheduled sync, hash-based change detection, safe (non-destructive) sync, duplicate merge, data-quality flags | Done |
| Doctor directory: multi-term search ("Oncologist Delhi", "Category A Apollo"), filters, sorting, pagination, column visibility, CSV export, bulk select | Done |
| Doctor profile: business info, contact, dates, engagement, activity timeline, Google Sheet source traceability with original values | Done |
| NPP (Oncology / Hematology) and Rare Disease (dynamic specialty) views | Done |
| Dashboard and patient feedback analytics | Done |
| Email templates: view, live preview, edit from the dashboard (written back to the Google Sheet) | Done |
| Calendar: birthdays, anniversaries, automation sends, feedback requests, scheduled runs | Done |
| Users and audit logs | Done |
| Sending email / WhatsApp from the app, reply tracking, campaigns, audience builder, follow-ups | Phase 2 |

## Connected Google Sheets

| Sheet | Becomes |
|---|---|
| MSL ALL INDIA → `Doctors` | NPP doctors (ONC → Oncology, HEMA → Hematology) + 1st / 20th mail history |
| Doctor Email List (Rare Disease) → `Doctor List` | Rare Disease doctors (Genetics, Neuro) + intro email history |
| Doctor Thank-you Automation → `Sheet1` | NPP doctors + thank-you email history per medicine |
| Patient Feedback WhatsApp Automation → `Sheet1` | Patient feedback (Onco → NPP, RD → Rare Diseases) |

The NPP and Rare Disease **master** sheets (BDM, NSM, Category A/B/C, DOB, anniversary) plug in the same way: add the spreadsheet in the Sync Center; the column names are recognised automatically.

## Repository layout

```
api/index.py            Vercel Python entry point (FastAPI)
backend/app/            FastAPI app: core (config, security, Supabase client), api routers, services
backend/tests/          Mapping, permission and sync tests
src/                    Next.js 14 (App Router, TypeScript, Tailwind, TanStack Query, Recharts)
supabase/migrations/    Database schema and RLS
docs/                   Architecture, database, API, deployment, security, Google Sheets, environment
```

## Local development

```bash
cp .env.example .env.local          # fill in the Supabase keys
npm install
pip install -r backend/requirements-dev.txt
npm run dev:api                     # FastAPI on :8000
npm run dev                         # Next.js on :3000 (proxies /api to :8000)
cd backend && pytest                # tests
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup and the first sync.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md) · [Google Sheets](docs/GOOGLE_SHEETS.md) · [Email & WhatsApp](docs/EMAIL_WHATSAPP.md) · [Environment](docs/ENVIRONMENT.md)

> Never commit `.env` files, sheet exports or any doctor / patient data. This repository contains code only.
