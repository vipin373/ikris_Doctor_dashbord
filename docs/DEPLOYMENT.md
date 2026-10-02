# Deployment

## Supabase

Project `IKRIS Doctor Connect` is created and migrated (`supabase/migrations`). For a fresh project, run the migrations in order in the SQL editor.

Auth settings (Supabase → Authentication → URL Configuration): set **Site URL** to the Vercel production URL and add `<url>/reset-password` to **Redirect URLs**.

## Vercel

One project serves both the Next.js app and the FastAPI function (`api/index.py`, routed by `vercel.json`).

Environment variables (Production + Preview):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes for sync / invites | Supabase → Settings → API |
| `APP_URL` | yes | e.g. `https://ikris-doctor-connect.vercel.app` |
| `CRON_SECRET` | yes for scheduled sync | random string |
| `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PROJECT_ID` | recommended | service account |

## First run

1. Create your user: Supabase → Authentication → Users → **Add user** with `bharat@ikrispharmanetwork.com` (listed in `bootstrap_admins`, so it becomes Admin). Or use any email after adding it to `bootstrap_admins`.
2. Sign in at the Vercel URL.
3. Open **Google Sheets** → **Sync now**. Doctors, outreach history and patient feedback load.
4. Invite NPP and Rare Disease users from **Users**.

## Local

See README. The Next.js dev server proxies `/api` to `uvicorn` on port 8000.
