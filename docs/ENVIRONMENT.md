# Environment variables

See `.env.example`. Rules:

- Only `NEXT_PUBLIC_*` values reach the browser. They are safe to expose (Supabase URL and anon key; RLS protects data).
- `SUPABASE_SERVICE_ROLE_KEY`, Google credentials, `CRON_SECRET`, email and WhatsApp keys are server-only.
- `GOOGLE_PRIVATE_KEY` can be pasted with literal `\n`; the backend converts them.
- Never commit `.env` or `.env.local`.
