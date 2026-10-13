-- Follow-up reminders: when each doctor is due their next email.
insert into public.app_settings (key, value) values ('reminder_settings', '{"npp_days": 20, "rare_days": 15}')
on conflict (key) do nothing;
create policy app_settings_read_reminders on public.app_settings for select to authenticated
  using (key = 'reminder_settings');

create or replace function public.follow_up_reminders()
returns table (
  doctor_id uuid, doctor_name text, department text, sub_department text, institute text, email text, phone text,
  must_see boolean, last_sent_at timestamptz, last_campaign text, interval_days int, due_date date,
  pending text[], failed text[]
)
language sql stable security invoker set search_path = public as $$
  with s as (select coalesce((select value from app_settings where key = 'reminder_settings'), '{}'::jsonb) as v),
  ev as (
    select e.doctor_id, e.campaign, e.occurred_at,
      row_number() over (partition by e.doctor_id order by e.occurred_at desc) as rn
    from communication_events e
    where e.channel = 'EMAIL' and e.direction = 'OUTBOUND' and e.occurred_at is not null
      and e.status in ('Sent', 'Delivered', 'Opened', 'Clicked', 'Replied')
      and coalesce(e.campaign, '') not ilike '%birthday%' and coalesce(e.campaign, '') not ilike '%thank%'
  ),
  last as (select * from ev where rn = 1),
  pend as (
    select e.doctor_id,
      array_agg(distinct e.campaign) filter (where e.status = 'Not sent') as pending,
      array_agg(distinct e.campaign) filter (where e.status = 'Failed') as failed
    from communication_events e where e.channel = 'EMAIL' group by 1
  )
  select d.id, d.doctor_name, d.department, d.sub_department, d.institute, d.email,
    coalesce(d.whatsapp_number, d.contact_number), d.must_see,
    l.occurred_at, l.campaign, x.days,
    case when l.occurred_at is null then null else (l.occurred_at at time zone 'Asia/Kolkata')::date + x.days end,
    p.pending, p.failed
  from doctors d
  cross join s
  left join last l on l.doctor_id = d.id
  left join pend p on p.doctor_id = d.id
  cross join lateral (
    select coalesce(d.frequency_days,
      case when d.department = 'RARE_DISEASES' then coalesce((s.v->>'rare_days')::int, 15)
           else coalesce((s.v->>'npp_days')::int, 20) end) as days
  ) x
  where d.email_norm is not null and (l.doctor_id is not null or p.failed is not null)
$$;
grant execute on function public.follow_up_reminders() to authenticated;
revoke execute on function public.follow_up_reminders() from anon;

-- New molecules: the first FDA approval of an active ingredient (by its base name) in our FDA data.
create or replace function public.new_molecules(p_days int default 365)
returns table (
  id uuid, drug_name text, active_ingredient text, manufacturer text, department text, therapeutic_areas text[],
  approval_date date, india_status text, created_at timestamptz, application_number text
)
language sql stable security invoker set search_path = public as $$
  select f.id, f.drug_name, f.active_ingredient, f.manufacturer, f.department, f.therapeutic_areas,
    f.approval_date, f.india_status, f.created_at, f.application_number
  from fda_drugs f
  where f.approval_date >= current_date - p_days
    and cardinality(coalesce(f.india_keys, '{}')) > 0
    and not exists (
      select 1 from fda_drugs o
      where o.id <> f.id and o.india_keys = f.india_keys and o.approval_date < f.approval_date
    )
  order by f.approval_date desc, f.drug_name
$$;
grant execute on function public.new_molecules(int) to authenticated;
revoke execute on function public.new_molecules(int) from anon;

-- New drugs are detected by the daily FDA sync.
update public.app_settings set value = jsonb_set(value, '{schedule}', '"daily"') where key = 'fda_settings';
