-- Full list of doctors with a birthday or a work anniversary, for the separate
-- Birthdays and Work Anniversaries pages. Runs as the caller, so RLS keeps each
-- department to its own doctors.
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
    select id, doctor_name, department, sub_department, institute, email, contact_number,
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

grant execute on function public.important_dates(text) to authenticated;
revoke execute on function public.important_dates(text) from public, anon;
