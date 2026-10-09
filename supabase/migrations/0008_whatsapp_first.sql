-- Birthday / anniversary lists: use the WhatsApp number when the sheet has one.
create or replace function public.upcoming_dates(p_days int)
returns table (
  doctor_id uuid, doctor_name text, department text, sub_department text, institute text,
  email text, contact_number text, kind text, next_date date, days_until int
)
language sql
stable
security invoker
set search_path = public
as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  x as (
    select id, doctor_name, department, sub_department, institute, email, coalesce(whatsapp_number, contact_number) as contact_number,
      'birthday' as kind, date_of_birth as dt
    from doctors where date_of_birth is not null
    union all
    select id, doctor_name, department, sub_department, institute, email, coalesce(whatsapp_number, contact_number),
      'anniversary', date_of_anniversary
    from doctors where date_of_anniversary is not null
  ),
  n as (
    select x.*, t.d,
      (x.dt + make_interval(years => (extract(year from t.d) - extract(year from x.dt))::int))::date as this_year
    from x, today t
  ),
  m as (
    select n.*, case when this_year < d then (this_year + interval '1 year')::date else this_year end as nd from n
  )
  select id, doctor_name, department, sub_department, institute, email, contact_number, kind, nd, (nd - d)
  from m
  where nd - d <= p_days
  order by nd, doctor_name
$$;

create or replace function public.important_dates(p_kind text)
returns table (
  doctor_id uuid, doctor_name text, department text, sub_department text, institute text,
  email text, contact_number text, original date, next_date date, days_until int, last_wish_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  x as (
    select id, doctor_name, department, sub_department, institute, email, coalesce(whatsapp_number, contact_number) as contact_number,
      case when p_kind = 'birthday' then date_of_birth else date_of_anniversary end as dt
    from doctors
    where p_kind in ('birthday', 'anniversary')
  ),
  n as (
    select x.*, t.d,
      (x.dt + make_interval(years => (extract(year from t.d) - extract(year from x.dt))::int))::date as this_year
    from x, today t
    where x.dt is not null
  ),
  m as (
    select n.*, case when this_year < d then (this_year + interval '1 year')::date else this_year end as nd from n
  )
  select m.id, m.doctor_name, m.department, m.sub_department, m.institute, m.email, m.contact_number,
    m.dt, m.nd, (m.nd - m.d),
    (select max(e.occurred_at) from communication_events e
      where e.doctor_id = m.id
        and (e.campaign ilike '%birthday%' or e.campaign ilike '%anniversar%'
             or e.event_type ilike '%birthday%' or e.event_type ilike '%anniversar%'))
  from m
  order by m.nd, m.doctor_name
$$;
