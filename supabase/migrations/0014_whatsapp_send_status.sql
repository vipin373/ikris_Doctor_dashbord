-- MSL ALL INDIA sheet: "whatsapp send status" / "whatsapp send date" columns become
-- WhatsApp communication events, and each doctor keeps their latest WhatsApp status/date.
alter table public.doctors add column if not exists last_whatsapp_status text;
alter table public.doctors add column if not exists last_whatsapp_at timestamptz;

create or replace function app_private.refresh_doctor_contact(p_doctor uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.doctors d set
    emails_sent = s.emails,
    whatsapp_sent = s.whatsapps,
    last_contact_at = s.last_at,
    last_contact_channel = s.last_channel,
    last_contact_status = s.last_status,
    last_whatsapp_status = s.wa_status,
    last_whatsapp_at = s.wa_at
  from (
    select
      count(*) filter (where channel = 'EMAIL' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Opened','Clicked','Replied')) as emails,
      count(*) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Read','Replied')) as whatsapps,
      (array_agg(occurred_at order by occurred_at desc nulls last))[1] as last_at,
      (array_agg(channel order by occurred_at desc nulls last))[1] as last_channel,
      (array_agg(status order by occurred_at desc nulls last))[1] as last_status,
      (array_agg(status order by occurred_at desc nulls last) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND'))[1] as wa_status,
      (array_agg(occurred_at order by occurred_at desc nulls last) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND'))[1] as wa_at
    from public.communication_events where doctor_id = p_doctor
  ) s
  where d.id = p_doctor;
$$;

-- Add the WhatsApp column pair to the MSL ALL INDIA Doctors tab mapping (once).
update public.google_sheet_tabs t
set mapping = jsonb_set(t.mapping, '{events}', coalesce(t.mapping->'events', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
  'channel', 'WHATSAPP', 'event_type', 'WhatsApp', 'campaign', 'NPP WhatsApp',
  'status_column', 'whatsapp send status', 'date_column', 'whatsapp send date')))
from public.google_sheet_sources s
where s.id = t.source_id and s.spreadsheet_id = '1Qc94AybcuQ5NbXYX-wlc8-WBi6VARsuKs5KSC_7IIbs'
  and t.data_kind = 'doctors'
  and not exists (select 1 from jsonb_array_elements(coalesce(t.mapping->'events', '[]'::jsonb)) e where e->>'status_column' = 'whatsapp send status');

select app_private.refresh_doctor_contact(id) from public.doctors where whatsapp_sent > 0;
