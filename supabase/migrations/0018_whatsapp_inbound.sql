-- Internal writer for outreach history (no access check; callers check).
create or replace function app_private.write_outreach_event(p_message_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select om.*, oc.name as campaign_name, oc.subject, oc.sequence into m
    from public.outreach_messages om join public.outreach_campaigns oc on oc.id = om.campaign_id
   where om.id = p_message_id;
  if not found then return; end if;
  insert into public.communication_events (doctor_id, department, channel, direction, event_type, status, subject, detail,
                                           campaign, occurred_at, source, external_key, category_at_send)
  values (m.doctor_id, m.department, m.channel, 'OUTBOUND', coalesce(m.sequence, 'Outreach'),
          case m.status when 'SENT' then 'Sent' when 'DELIVERED' then 'Delivered' when 'READ' then 'Read'
                        when 'FAILED' then 'Failed' when 'SKIPPED' then 'Not sent' else initcap(m.status) end,
          case when m.channel = 'EMAIL' then m.subject end, m.error, m.campaign_name, coalesce(m.sent_at, now()),
          'outreach', 'outreach:' || m.id, m.category_at_send)
  on conflict (external_key) do update set status = excluded.status, detail = excluded.detail;
end;
$$;
revoke all on function app_private.write_outreach_event(bigint) from public, anon, authenticated;

create or replace function public.record_outreach_event(p_message_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.outreach_messages where id = p_message_id
                  and app_private.can_access_department(department)) then
    raise exception 'Message not found';
  end if;
  perform app_private.write_outreach_event(p_message_id);
end;
$$;

-- WhatsApp replies via the Cunnekt webhook (same token as delivery receipts):
-- incoming messages are matched to doctors by WhatsApp / phone number (last 10 digits)
-- and stored as INBOUND "Replied" events. Delivery receipts also update outreach messages.
create or replace function public.record_whatsapp_inbound(p_token text, p_messages jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
declare m jsonb; v_doc record; n int := 0; v_digits text;
begin
  if not app_private.valid_token('webhook', p_token) then
    raise exception 'Invalid webhook token';
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    v_digits := right(regexp_replace(coalesce(m->>'from', ''), '\D', '', 'g'), 10);
    continue when length(v_digits) < 10 or coalesce(m->>'id', '') = '';
    for v_doc in
      select id, department from public.doctors
       where right(regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'), 10) = v_digits
          or right(regexp_replace(coalesce(phone_norm, ''), '\D', '', 'g'), 10) = v_digits
    loop
      insert into public.communication_events (doctor_id, department, channel, direction, event_type, status, detail,
                                               campaign, occurred_at, source, external_key)
      values (v_doc.id, v_doc.department, 'WHATSAPP', 'INBOUND', 'WhatsApp reply', 'Replied',
              left(coalesce(nullif(m->>'text', ''), '[' || coalesce(m->>'type', 'message') || ']'), 2000),
              null, coalesce((m->>'occurred_at')::timestamptz, now()), 'cunnekt_webhook',
              'wa-in:' || (m->>'id') || ':' || v_doc.id)
      on conflict (external_key) do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.record_whatsapp_inbound(text, jsonb) from public;
grant execute on function public.record_whatsapp_inbound(text, jsonb) to anon, authenticated;

create or replace function public.outreach_record_status(p_token text, p_events jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
declare e jsonb; n int := 0; v_status text; r record;
begin
  if not app_private.valid_token('webhook', p_token) then
    raise exception 'Invalid webhook token';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_status := case upper(e->>'status') when 'DELIVERED' then 'DELIVERED' when 'READ' then 'READ'
                                         when 'FAILED' then 'FAILED' when 'SENT' then 'SENT' end;
    continue when v_status is null;
    for r in update public.outreach_messages om
                set status = case
                      when om.status = 'READ' then 'READ'
                      when om.status = 'DELIVERED' and v_status = 'SENT' then 'DELIVERED'
                      else v_status end,
                    error = case when v_status = 'FAILED' then coalesce(e->>'error', om.error) else om.error end
              where om.provider_message_id = e->>'provider_message_id'
             returning om.id loop
      n := n + 1;
      perform app_private.write_outreach_event(r.id);
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.outreach_record_status(text, jsonb) from public;
grant execute on function public.outreach_record_status(text, jsonb) to anon, authenticated;
