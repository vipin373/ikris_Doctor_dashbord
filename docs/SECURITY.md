# Security

- **Supabase Auth only.** No custom password handling. Sessions are JWTs refreshed by supabase-js.
- **Three roles**, stored in `profiles.role`, changeable only by an Admin (RLS + API). New users have no access until a role is assigned.
- **Defence in depth for department isolation:** frontend hides modules; FastAPI rejects forbidden departments (403) and scopes queries; Postgres RLS filters every row again because FastAPI queries with the caller's JWT.
- **Service role key** is used only server-side (sync, invitations, audit logs, source names). It is never sent to the browser.
- **Helper functions** used by RLS live in a non-exposed schema (`app_private`); Supabase security advisors report no findings.
- **Exports** use the same permission-scoped query and are audit-logged.
- **Audit log:** login, logout, sync, export, user created, permission changed, settings changed.
- **Rate limiting** per IP in the API (best effort on serverless), CORS restricted to the app URL, security headers on every response.
- **Cron endpoint** requires `Authorization: Bearer <CRON_SECRET>`.
- **No real data in git.** `.gitignore` blocks `.env*`, CSV and Excel files.

## Important: public Google Sheets

The four current sheets are shared as *Anyone with the link can view*. Anyone holding a link can read doctor and patient phone numbers and emails. Recommended:

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Share each sheet with the service account email as **Viewer**.
3. Set `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PROJECT_ID` in Vercel.
4. In the Sync Center, remove `"access_mode": "public_link"` from each tab's mapping.
5. Change each sheet's sharing to **Restricted**.

Service-account mode also enables automatic discovery of new tabs.
