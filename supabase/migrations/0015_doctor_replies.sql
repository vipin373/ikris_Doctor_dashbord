-- MSL ALL INDIA: "Email Reply" / "WhatsApp Reply" columns become INBOUND events.
-- Each doctor keeps their latest reply; "last contact" now means our outbound contact only.
alter table public.doctors add column if not exists last_reply_at timestamptz;
alter table public.doctors add column if not exists last_reply_status text;
alter table public.doctors add column if not exists last_reply_channel text;
alter table public.doctors add column if not exists last_reply_text text;
alter table public.doctors add column if not exists replies_count integer not null default 0;

create or replace function app_private.refresh_doctor_contact(p_doctor uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.doctors d set
    emails_sent = s.emails,
    whatsapp_sent = s.whatsapps,
    last_contact_at = s.last_at,
    last_contact_channel = s.last_channel,
    last_contact_status = s.last_status,
    last_whatsapp_status = s.wa_status,
    last_whatsapp_at = s.wa_at,
    replies_count = s.replies,
    last_reply_at = s.r_at,
    last_reply_status = s.r_status,
    last_reply_channel = s.r_channel,
    last_reply_text = s.r_text
  from (
    select
      count(*) filter (where channel = 'EMAIL' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Opened','Clicked','Replied')) as emails,
      count(*) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Read','Replied')) as whatsapps,
      (array_agg(occurred_at order by occurred_at desc nulls last) filter (where direction = 'OUTBOUND'))[1] as last_at,
      (array_agg(channel order by occurred_at desc nulls last) filter (where direction = 'OUTBOUND'))[1] as last_channel,
      (array_agg(status order by occurred_at desc nulls last) filter (where direction = 'OUTBOUND'))[1] as last_status,
      (array_agg(status order by occurred_at desc nulls last) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND'))[1] as wa_status,
      (array_agg(occurred_at order by occurred_at desc nulls last) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND'))[1] as wa_at,
      count(*) filter (where direction = 'INBOUND' and status = 'Replied') as replies,
      (array_agg(occurred_at order by (status = 'Replied') desc, occurred_at desc nulls last) filter (where direction = 'INBOUND'))[1] as r_at,
      (array_agg(status order by (status = 'Replied') desc, occurred_at desc nulls last) filter (where direction = 'INBOUND'))[1] as r_status,
      (array_agg(channel order by (status = 'Replied') desc, occurred_at desc nulls last) filter (where direction = 'INBOUND'))[1] as r_channel,
      (array_agg(detail order by (status = 'Replied') desc, occurred_at desc nulls last) filter (where direction = 'INBOUND'))[1] as r_text
    from public.communication_events where doctor_id = p_doctor
  ) s
  where d.id = p_doctor;
$$;

-- Dashboard: real replies vs automatic replies (out-of-office, address changed)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dashboard_summary()'::regprocedure);
  if position('auto_replies' in d) = 0 then
    d := replace(d,
      $q$'replies', (select count(*) from ev where direction = 'INBOUND'),$q$,
      $q$'replies', (select count(*) from ev where direction = 'INBOUND' and status = 'Replied'),
    'auto_replies', (select count(*) from ev where direction = 'INBOUND' and status = 'Auto-reply'),
    'replied_doctors', (select count(distinct doctor_id) from ev where direction = 'INBOUND' and status = 'Replied'),$q$);
    execute d;
  end if;
end $$;

-- Add the reply columns to the MSL ALL INDIA Doctors tab mapping (once).
update public.google_sheet_tabs t
set mapping = jsonb_set(t.mapping, '{events}', coalesce(t.mapping->'events', '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object('reply_column', 'Email Reply', 'channel', 'EMAIL', 'event_type', 'Email reply', 'campaign', 'NPP Email reply'),
  jsonb_build_object('reply_column', 'WhatsApp Reply', 'channel', 'WHATSAPP', 'event_type', 'WhatsApp reply', 'campaign', 'NPP WhatsApp reply')))
from public.google_sheet_sources s
where s.id = t.source_id and s.spreadsheet_id = '1Qc94AybcuQ5NbXYX-wlc8-WBi6VARsuKs5KSC_7IIbs'
  and t.data_kind = 'doctors'
  and not exists (select 1 from jsonb_array_elements(coalesce(t.mapping->'events', '[]'::jsonb)) e where e ? 'reply_column');
