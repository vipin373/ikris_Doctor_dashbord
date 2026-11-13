-- Plain-language outreach summary per email / WhatsApp round (RLS: user's departments only).
-- A reply is counted against the last message of the same channel sent to that doctor on or before
-- the reply's day (India time); if none, against the doctor's first message on that channel.
create or replace function public.dashboard_outreach()
returns jsonb language sql stable set search_path to 'public' as $function$
  with ev as (select * from public.communication_events),
  outb as (
    select doctor_id, channel, event_type, status, occurred_at from ev
     where direction = 'OUTBOUND' and status in ('Sent','Delivered','Opened','Clicked','Read','Replied')
  ),
  inb as (
    select e.id, e.doctor_id, e.channel, e.status,
           coalesce(
             (select o.event_type from outb o
               where o.doctor_id = e.doctor_id and o.channel = e.channel
                 and e.occurred_at is not null and o.occurred_at is not null
                 and (o.occurred_at at time zone 'Asia/Kolkata')::date <= (e.occurred_at at time zone 'Asia/Kolkata')::date
               order by o.occurred_at desc limit 1),
             (select o.event_type from outb o
               where o.doctor_id = e.doctor_id and o.channel = e.channel
               order by o.occurred_at asc nulls last limit 1)) as round
      from ev e where e.direction = 'INBOUND'
  ),
  rounds as (
    select channel, event_type as round,
           count(distinct doctor_id) filter (where status in ('Sent','Delivered','Opened','Clicked','Read','Replied')) as sent_doctors,
           count(*) filter (where status in ('Sent','Delivered','Opened','Clicked','Read','Replied')) as sent_messages,
           count(distinct doctor_id) filter (where status = 'Failed') as failed_doctors,
           count(distinct doctor_id) filter (where status = 'Not sent') as pending_doctors,
           max(occurred_at) filter (where status in ('Sent','Delivered','Opened','Clicked','Read','Replied')) as last_sent_at
      from ev where direction = 'OUTBOUND'
     group by 1, 2
  ),
  rep as (
    select channel, round,
           count(*) filter (where status = 'Replied') as replies,
           count(distinct doctor_id) filter (where status = 'Replied') as replied_doctors,
           count(*) filter (where status = 'Auto-reply') as auto_replies,
           count(distinct doctor_id) filter (where status = 'Auto-reply') as auto_doctors
      from inb group by 1, 2
  )
  select jsonb_build_object(
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel', r.channel, 'round', r.round, 'sent_doctors', r.sent_doctors, 'sent_messages', r.sent_messages,
        'failed_doctors', r.failed_doctors, 'pending_doctors', r.pending_doctors, 'last_sent_at', r.last_sent_at,
        'replies', coalesce(p.replies, 0), 'replied_doctors', coalesce(p.replied_doctors, 0),
        'auto_replies', coalesce(p.auto_replies, 0), 'auto_doctors', coalesce(p.auto_doctors, 0))
        order by r.channel, r.sent_doctors desc)
      from rounds r left join rep p on p.channel = r.channel and p.round = r.round
    ), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_object_agg(channel, n) from (
        select channel, count(*) n from inb where round is null group by 1) u), '{}'::jsonb),
    'totals', (select jsonb_build_object(
        'email_sent_doctors', count(distinct doctor_id) filter (where channel = 'EMAIL'),
        'email_sent_messages', count(*) filter (where channel = 'EMAIL'),
        'whatsapp_sent_doctors', count(distinct doctor_id) filter (where channel = 'WHATSAPP'),
        'whatsapp_sent_messages', count(*) filter (where channel = 'WHATSAPP')) from outb),
    'reply_totals', (select jsonb_build_object(
        'email_replies', count(*) filter (where channel = 'EMAIL' and status = 'Replied'),
        'email_auto', count(*) filter (where channel = 'EMAIL' and status = 'Auto-reply'),
        'whatsapp_replies', count(*) filter (where channel = 'WHATSAPP' and status = 'Replied'),
        'replied_doctors', count(distinct doctor_id) filter (where status = 'Replied'),
        'email_replied_doctors', count(distinct doctor_id) filter (where channel = 'EMAIL' and status = 'Replied'),
        'email_auto_doctors', count(distinct doctor_id) filter (where channel = 'EMAIL' and status = 'Auto-reply'),
        'whatsapp_replied_doctors', count(distinct doctor_id) filter (where channel = 'WHATSAPP' and status = 'Replied')) from inb)
  )
$function$;
grant execute on function public.dashboard_outreach() to authenticated;
