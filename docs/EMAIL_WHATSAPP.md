# Email and WhatsApp (phase 2)

Phase 1 records outreach history from the existing automation sheets (1st / 20th mail, Rare Disease intro emails, thank-you emails, WhatsApp review requests) as `communication_events`, and offers mail / WhatsApp / call links on every doctor.

Phase 2 adds provider abstractions in the backend:

- `EmailService`: `send_email`, `send_bulk_email`, `schedule_email`, `get_email_status`, `process_webhook` — statuses Queued → Sending → Sent → Delivered → Opened → Clicked → Replied / Failed.
- `WhatsAppService`: `send_message`, `send_bulk_message`, `send_template`, `get_message_status`, `process_incoming_message`, `process_webhook` — statuses Queued → Sent → Delivered → Read → Replied / Failed (WhatsApp Cloud API).

Every send and every inbound reply writes a `communication_events` row, so the doctor timeline, dashboard and engagement metrics work unchanged. Keys stay server-side; webhooks verify signatures.
