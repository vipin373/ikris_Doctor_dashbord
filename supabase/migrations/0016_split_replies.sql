-- Separate Email and WhatsApp replies: per-doctor latest reply per channel + dashboard counts.
-- Applied live on 2026-11-06; refresh_doctor_contact() body = 0015 plus the er_*/wr_* fields below.
alter table public.doctors add column if not exists email_reply_status text;
alter table public.doctors add column if not exists email_reply_at timestamptz;
alter table public.doctors add column if not exists email_reply_text text;
alter table public.doctors add column if not exists whatsapp_reply_status text;
alter table public.doctors add column if not exists whatsapp_reply_at timestamptz;
alter table public.doctors add column if not exists whatsapp_reply_text text;
-- refresh_doctor_contact additionally sets, per channel (EMAIL / WHATSAPP), from INBOUND events
-- ordered by (status = 'Replied') desc, occurred_at desc: <channel>_reply_status, _at, _text.
-- dashboard_summary additionally returns email_replies, email_auto_replies, email_replied_doctors,
-- whatsapp_replies, whatsapp_auto_replies, whatsapp_replied_doctors.
