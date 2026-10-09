# FDA Drug Intelligence + Doctor Communication

Sidebar → **FDA** (`/fda`). Tabs: Drug Intelligence · Single Message · Bulk Upload · Templates · Sent Messages.

## Data flow

```
openFDA (drug labels + Drugs@FDA) → FastAPI fda_service → normalise → fda_sync_write (Supabase, upsert by NDA/BLA number)
  → drug_classifier (FDA label evidence) → doctor_matcher → template / AI / manual draft → human approval
  → Cunnekt WhatsApp / SMTP email → message_logs (+ Cunnekt delivery webhook)
```

* Scope: prescription NDA/BLA products whose FDA label indication mentions an oncology, hematology or
  rare-disease condition (terms in `backend/app/services/drug_classifier.py`).
* One row per FDA application number. Re-syncs update in place (record hash); nothing is duplicated.
* Drugs with no Drugs@FDA record (often CBER biologics) keep a review flag; approval data is never invented.
* Sync is resumable in ~40 s chunks (`POST /api/fda/sync`, Admin). The dashboard keeps calling until done.
* Scheduled: Vercel cron `GET /api/cron/fda-sync` daily (Bearer `CRON_SECRET`), or n8n with header
  `X-Automation-Token`. The endpoint only runs when due under FDA settings → schedule (daily / weekly / manual)
  and fetches only labels changed since the last sync. `CRON_SECRET` must equal the automation token whose
  SHA-256 hash is in `app_settings.automation_token` (FDA settings → automation token creates a new one).

## Classification

`FDA_LABEL_RULES`: phrases found in the FDA indication, recorded as evidence. Weak terms only, a single passing
mention late in the text, or no indication → `NEEDS_REVIEW`. NEEDS_REVIEW and REJECTED drugs are never offered
for messages. Admin can review manually, or ask OpenRouter for a second opinion that is accepted only when it
quotes the FDA indication word for word. KEGG (optional, `KEGG_API_BASE_URL`; commercial use needs a KEGG
licence) never overrides FDA data; disagreements are flagged.

## Messages

* Doctor areas: Rare Diseases dept → Rare Disease; sub-department / specialty → Oncology / Hematology.
  Doctors with no matching specialty never get drugs automatically.
* Methods: active template (versioned), AI (OpenRouter, facts from the FDA record only; any number not in the
  FDA data blocks the draft), or manual. Unfilled `{{variables}}` block approval.
* Nothing is sent without approval. Sending re-checks classification, contact data and the doctor's
  contact-frequency window (`next_eligible_at`).
* WhatsApp: approved Cunnekt template (`sendtemplate`) when the template has an approved Cunnekt name;
  otherwise free text (`replymessage`), which WhatsApp delivers only inside the 24-hour service window.
  "Sent" = Cunnekt returned a message id; Delivered/Read come only from the webhook
  (FDA settings → Cunnekt webhook URL).
* Email: SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`). "Sent" = accepted by the
  mail server; SMTP has no delivery/read receipts.
* `message_logs` keeps the exact text sent; a trigger blocks edits. Sends also appear in the doctor's
  communication history.

## Environment (server only)

`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4.5`), `CUNNEKT_API_KEY`,
`CUNNEKT_BASE_URL`, `SMTP_*`, `EMAIL_FROM`, `FDA_API_BASE_URL`, optional `FDA_API_KEY` (higher openFDA limits),
optional `KEGG_API_BASE_URL`, `CRON_SECRET`.
