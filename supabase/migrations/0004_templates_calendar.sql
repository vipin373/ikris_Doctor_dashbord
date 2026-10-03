-- Email templates, calendar, manually entered birthdays / anniversaries.

-- Settings table (planned earlier, created here).
alter table public.google_sheet_sources
  add column if not exists access_mode text not null default 'service_account'
    check (access_mode in ('service_account', 'public_link'));
update public.google_sheet_sources set access_mode = 'public_link';

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.app_settings enable row level security;
create policy app_settings_admin on public.app_settings for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());
insert into public.app_settings (key, value) values ('sync_frequency', '"daily"') on conflict (key) do nothing;

-- ---------------------------------------------------------------- templates
alter table public.google_sheet_tabs drop constraint if exists google_sheet_tabs_data_kind_check;
alter table public.google_sheet_tabs add constraint google_sheet_tabs_data_kind_check
  check (data_kind in ('doctors', 'feedback', 'templates', 'ignore'));

-- Apps Script web app that lets the dashboard write template edits back to
-- the spreadsheet (see docs/GOOGLE_SHEETS.md). Admin-only table.
alter table public.google_sheet_sources
  add column if not exists write_bridge_url text,
  add column if not exists write_bridge_token text;

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  department text not null references public.departments(code),
  source_id bigint references public.google_sheet_sources(id) on delete cascade,
  tab_id bigint references public.google_sheet_tabs(id) on delete cascade,
  source_name text,
  spreadsheet_id text not null,
  sheet_name text not null,
  sheet_gid bigint,
  source_ref text not null,
  kind text not null check (kind in ('email', 'campaign', 'subject_line')),
  name text not null,
  campaign text,
  specialty text,
  subject text,
  body_html text,
  is_active boolean,
  notes text,
  subject_cell text,
  body_cell text,
  active_cell text,
  sort_order int not null default 0,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_email text,
  unique (spreadsheet_id, sheet_name, source_ref)
);
create index email_templates_department_idx on public.email_templates (department, sort_order);

alter table public.email_templates enable row level security;
create policy email_templates_read on public.email_templates for select to authenticated
  using (app_private.can_access_department(department));
create policy email_templates_write on public.email_templates for all to authenticated
  using (app_private.can_access_department(department))
  with check (app_private.can_access_department(department));

-- Where to write a template edit. Returned only to users who can access a
-- template of that spreadsheet; used server-side by the API.
create or replace function public.sheet_write_target(p_spreadsheet text)
returns table (spreadsheet_id text, bridge_url text, bridge_token text)
language sql
stable
security definer
set search_path = public
as $$
  select s.spreadsheet_id, s.write_bridge_url, s.write_bridge_token
  from google_sheet_sources s
  where s.spreadsheet_id = p_spreadsheet
    and exists (
      select 1 from email_templates t
      where t.spreadsheet_id = p_spreadsheet and app_private.can_access_department(t.department)
    )
$$;
revoke all on function public.sheet_write_target(text) from public, anon;
grant execute on function public.sheet_write_target(text) to authenticated;

-- ------------------------------------------------- manual birthdays / dates
alter table public.doctors add column if not exists manual_fields jsonb not null default '{}'::jsonb;

-- Sync sends null for columns a sheet does not have. Keep dates entered in
-- the dashboard unless the sheet supplies a value.
create or replace function app_private.keep_manual_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.manual_fields ? 'date_of_birth' and new.date_of_birth is null then
    new.date_of_birth := old.date_of_birth;
  end if;
  if new.manual_fields ? 'date_of_anniversary' and new.date_of_anniversary is null then
    new.date_of_anniversary := old.date_of_anniversary;
  end if;
  return new;
end;
$$;
create trigger doctors_keep_manual before update on public.doctors
  for each row execute function app_private.keep_manual_fields();

create or replace function public.set_doctor_dates(p_doctor uuid, p_dob date, p_anniversary date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dept text;
begin
  select department into v_dept from doctors where id = p_doctor;
  if v_dept is null or not app_private.can_access_department(v_dept) then
    raise exception 'Doctor not found' using errcode = 'P0002';
  end if;
  update doctors set
    date_of_birth = p_dob,
    date_of_anniversary = p_anniversary,
    manual_fields = (manual_fields - 'date_of_birth' - 'date_of_anniversary')
      || case when p_dob is not null then '{"date_of_birth": true}'::jsonb else '{}'::jsonb end
      || case when p_anniversary is not null then '{"date_of_anniversary": true}'::jsonb else '{}'::jsonb end
  where id = p_doctor;
end;
$$;
revoke all on function public.set_doctor_dates(uuid, date, date) from public, anon;
grant execute on function public.set_doctor_dates(uuid, date, date) to authenticated;

-- ------------------------------------------------------------- calendar
create or replace function public.calendar_dates(p_month int)
returns table (doctor_id uuid, doctor_name text, department text, sub_department text, kind text, day int, original date)
language sql
stable
security invoker
set search_path = public
as $$
  select id, doctor_name, department, sub_department, 'birthday', extract(day from date_of_birth)::int, date_of_birth
  from doctors where extract(month from date_of_birth) = p_month
  union all
  select id, doctor_name, department, sub_department, 'anniversary', extract(day from date_of_anniversary)::int, date_of_anniversary
  from doctors where extract(month from date_of_anniversary) = p_month
$$;

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
    select id, doctor_name, department, sub_department, institute, email, contact_number, 'birthday' as kind, date_of_birth as dt
    from doctors where date_of_birth is not null
    union all
    select id, doctor_name, department, sub_department, institute, email, contact_number, 'anniversary', date_of_anniversary
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

grant execute on function public.calendar_dates(int) to authenticated;
grant execute on function public.upcoming_dates(int) to authenticated;
revoke execute on function public.calendar_dates(int) from anon;
revoke execute on function public.upcoming_dates(int) from anon;

-- Automation schedule shown on the calendar (editable by Admin in the app).
create policy app_settings_read_schedule on public.app_settings for select to authenticated
  using (key = 'automation_schedule');
insert into public.app_settings (key, value) values ('automation_schedule', '[
  {"name": "Rare Disease intro email (Template 1)", "department": "RARE_DISEASES", "days": [1], "time": "09:00",
   "note": "From the Instructions tab of the Doctor Email List sheet"},
  {"name": "Rare Disease intro email (Template 2)", "department": "RARE_DISEASES", "days": [16], "time": "09:00",
   "note": "From the Instructions tab of the Doctor Email List sheet"},
  {"name": "NPP 20th Mail (follow-up)", "department": "NPP", "days": [20], "time": "",
   "note": "Inferred from the 20th Mail columns in MSL ALL INDIA. Check the time in the Apps Script trigger."}
]'::jsonb)
on conflict (key) do nothing;

-- dashboard: how many doctors have a date of birth
create or replace function public.doctors_with_dates()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'with_dob', (select count(*) from doctors where date_of_birth is not null),
    'with_anniversary', (select count(*) from doctors where date_of_anniversary is not null)
  )
$$;
grant execute on function public.doctors_with_dates() to authenticated;
revoke execute on function public.doctors_with_dates() from anon;

-- ------------------------------------------------ template tab configuration
update public.google_sheet_tabs t set
  data_kind = 'templates', department_code = 'NPP', is_enabled = true,
  mapping = '{"access_mode": "public_link", "layout": "rows",
              "columns": {"campaign": "Campaign", "specialty": "Specialty", "subject": "Subject", "body": "Email Body", "active": "Active"}}'::jsonb
from public.google_sheet_sources s
where t.source_id = s.id and s.spreadsheet_id = '1Qc94AybcuQ5NbXYX-wlc8-WBi6VARsuKs5KSC_7IIbs' and t.tab_name = 'Campaigns';

update public.google_sheet_tabs t set
  data_kind = 'templates', department_code = 'RARE_DISEASES', is_enabled = true,
  mapping = '{"access_mode": "public_link", "layout": "cells", "subject_cell": "B1", "body_cell": "B2", "notes_cells": ["B4", "B5"]}'::jsonb
from public.google_sheet_sources s
where t.source_id = s.id and s.spreadsheet_id = '16YI9wxwERKlUct8p4fSqkAdk8nnX5Ue3t8Ji2n5OeuY' and t.tab_name like 'Email Template %';

update public.google_sheet_tabs t set
  data_kind = 'templates', department_code = 'RARE_DISEASES', is_enabled = true,
  mapping = '{"access_mode": "public_link", "layout": "subject_list", "column": "A", "start_row": 2,
              "info_cells": {"Next index (auto-managed)": "D1"}}'::jsonb
from public.google_sheet_sources s
where t.source_id = s.id and s.spreadsheet_id = '16YI9wxwERKlUct8p4fSqkAdk8nnX5Ue3t8Ji2n5OeuY' and t.tab_name = 'Subject Lines';
