-- IKRIS Doctor Connect - Phase 1 schema
-- Supabase PostgreSQL is the primary database. Google Sheets are an external
-- source that is synchronised one way (Sheet -> Database).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Roles and users
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('ADMIN', 'NPP', 'RARE_DISEASES');

create table public.departments (
  code text primary key,
  name text not null,
  sort_order int not null default 0
);

insert into public.departments (code, name, sort_order) values
  ('NPP', 'NPP (Named Patient Programme)', 1),
  ('RARE_DISEASES', 'Rare Diseases', 2);

create table public.specialties (
  id bigint generated always as identity primary key,
  department_code text not null references public.departments(code),
  name text not null,
  parent_id bigint references public.specialties(id),
  created_at timestamptz not null default now(),
  unique (department_code, name)
);

insert into public.specialties (department_code, name) values
  ('NPP', 'Oncology'),
  ('NPP', 'Hematology'),
  ('RARE_DISEASES', 'Genetics'),
  ('RARE_DISEASES', 'Neuro');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text not null,
  role public.app_role,               -- null = no access until an Admin assigns a role
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- Emails listed here become ADMIN automatically when their auth user is created.
create table public.bootstrap_admins (
  email text primary key
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case
      when exists (select 1 from public.bootstrap_admins b where lower(b.email) = lower(new.email))
        then 'ADMIN'::public.app_role
      when new.raw_app_meta_data->>'invited_role' in ('ADMIN', 'NPP', 'RARE_DISEASES')
        then (new.raw_app_meta_data->>'invited_role')::public.app_role
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by RLS. SECURITY DEFINER so they can read profiles
-- without recursive RLS evaluation.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'ADMIN', false)
$$;

create or replace function public.can_access_department(dept text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_app_role()
    when 'ADMIN' then true
    when 'NPP' then dept = 'NPP'
    when 'RARE_DISEASES' then dept = 'RARE_DISEASES'
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Google Sheet sources
-- ---------------------------------------------------------------------------
create table public.google_sheet_sources (
  id bigint generated always as identity primary key,
  name text not null,
  spreadsheet_id text not null unique,
  default_department text references public.departments(code),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.google_sheet_tabs (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.google_sheet_sources(id) on delete cascade,
  tab_name text not null,
  sheet_gid bigint,
  -- doctors | feedback | ignore
  data_kind text not null default 'ignore' check (data_kind in ('doctors', 'feedback', 'ignore')),
  department_code text references public.departments(code),
  sub_department text,
  specialty text,
  -- Mapping engine configuration (see GOOGLE_SHEETS.md)
  mapping jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default false,
  headers jsonb not null default '[]'::jsonb,
  record_count int not null default 0,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  discovered_at timestamptz not null default now(),
  unique (source_id, tab_name)
);

create table public.google_sheet_sync_logs (
  id bigint generated always as identity primary key,
  source_id bigint references public.google_sheet_sources(id) on delete set null,
  tab_id bigint references public.google_sheet_tabs(id) on delete set null,
  triggered_by uuid references auth.users(id) on delete set null,
  trigger_type text not null default 'manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  new_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  duplicate_count int not null default 0,
  flagged_missing_count int not null default 0,
  error_count int not null default 0,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Doctors
-- ---------------------------------------------------------------------------
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  department text not null references public.departments(code),
  sub_department text,
  -- identity used for duplicate detection: email > phone > name+institute
  dedupe_key text not null,
  s_no text,
  bdm text,
  nsm text,
  doctor_name text not null,
  qualification text,
  specialty text,
  category text check (category is null or category in ('A', 'B', 'C')),
  institute text,
  institute_address text,
  city text,
  state text,
  country text,
  contact_number text,
  whatsapp_number text,
  email text,
  date_of_birth date,
  date_of_anniversary date,
  -- normalised values used for search, filters and dedupe; originals stay above
  email_norm text,
  phone_norm text,
  name_norm text,
  city_norm text,
  data_issues jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  -- primary source traceability (first sheet row this doctor was seen in)
  source_spreadsheet_id text,
  source_sheet_name text,
  source_row_number int,
  source_record_hash text,
  last_synced_at timestamptz,
  -- outreach summary (maintained from communication_events)
  last_contact_at timestamptz,
  last_contact_channel text,
  last_contact_status text,
  emails_sent int not null default 0,
  whatsapp_sent int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(
      coalesce(doctor_name, '') || ' ' || coalesce(bdm, '') || ' ' || coalesce(nsm, '') || ' ' ||
      coalesce(qualification, '') || ' ' || coalesce(specialty, '') || ' ' ||
      coalesce('category ' || category, '') || ' ' || coalesce(institute, '') || ' ' ||
      coalesce(institute_address, '') || ' ' || coalesce(city, '') || ' ' || coalesce(state, '') || ' ' ||
      coalesce(contact_number, '') || ' ' || coalesce(email, '') || ' ' || department || ' ' ||
      case department when 'NPP' then 'npp' else 'rare disease' end || ' ' ||
      coalesce(sub_department, '')
    )
  ) stored,
  unique (department, dedupe_key)
);

create index doctors_department_idx on public.doctors (department, sub_department);
create index doctors_city_idx on public.doctors (city_norm);
create index doctors_search_trgm_idx on public.doctors using gin (search_text extensions.gin_trgm_ops);

-- Every sheet row that contributed to a doctor, with its original values.
create table public.doctor_source_rows (
  id bigint generated always as identity primary key,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  tab_id bigint references public.google_sheet_tabs(id) on delete set null,
  spreadsheet_id text not null,
  sheet_name text not null,
  row_number int not null,
  row_key text not null,
  raw_data jsonb not null,
  record_hash text not null,
  missing_from_source boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique (spreadsheet_id, sheet_name, row_key)
);
create index doctor_source_rows_doctor_idx on public.doctor_source_rows (doctor_id);

-- ---------------------------------------------------------------------------
-- Communication (Phase 1: history imported from the automation sheets)
-- ---------------------------------------------------------------------------
create table public.communication_events (
  id bigint generated always as identity primary key,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  department text not null references public.departments(code),
  channel text not null check (channel in ('EMAIL', 'WHATSAPP', 'CALL', 'NOTE')),
  direction text not null default 'OUTBOUND' check (direction in ('OUTBOUND', 'INBOUND')),
  event_type text not null,
  status text not null,
  subject text,
  detail text,
  campaign text,
  occurred_at timestamptz,
  source text not null default 'google_sheet',
  external_key text not null unique,
  created_at timestamptz not null default now()
);
create index communication_events_doctor_idx on public.communication_events (doctor_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Patient feedback
-- ---------------------------------------------------------------------------
create table public.patient_feedback (
  id uuid primary key default gen_random_uuid(),
  department text not null references public.departments(code),
  division text,
  patient_id text,
  patient_name text,
  country_code text,
  phone_number text,
  medicine text,
  doctor_id uuid references public.doctors(id) on delete set null,
  doctor_name text,
  hospital text,
  disease text,
  feedback text,
  rating int check (rating is null or rating between 1 and 5),
  request_date date,
  sent_date date,
  whatsapp_status text,
  review_link text,
  status text,
  follow_up_required boolean not null default false,
  assigned_user uuid references auth.users(id) on delete set null,
  notes text,
  data_issues jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  source_spreadsheet_id text,
  source_sheet_name text,
  source_row_number int,
  source_key text unique,
  source_record_hash text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patient_feedback_department_idx on public.patient_feedback (department, request_date desc);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger doctors_touch before update on public.doctors
  for each row execute function public.touch_updated_at();
create trigger patient_feedback_touch before update on public.patient_feedback
  for each row execute function public.touch_updated_at();

-- Keep the outreach summary on doctors in step with communication events.
create or replace function public.refresh_doctor_contact(p_doctor uuid)
returns void language sql security definer set search_path = public as $$
  update public.doctors d set
    emails_sent = s.emails,
    whatsapp_sent = s.whatsapps,
    last_contact_at = s.last_at,
    last_contact_channel = s.last_channel,
    last_contact_status = s.last_status
  from (
    select
      count(*) filter (where channel = 'EMAIL' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Opened','Clicked','Replied')) as emails,
      count(*) filter (where channel = 'WHATSAPP' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Read','Replied')) as whatsapps,
      (array_agg(occurred_at order by occurred_at desc nulls last))[1] as last_at,
      (array_agg(channel order by occurred_at desc nulls last))[1] as last_channel,
      (array_agg(status order by occurred_at desc nulls last))[1] as last_status
    from public.communication_events where doctor_id = p_doctor
  ) s
  where d.id = p_doctor;
$$;

create or replace function public.communication_events_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_doctor_contact(coalesce(new.doctor_id, old.doctor_id));
  return null;
end;
$$;

create trigger communication_events_refresh
  after insert or update or delete on public.communication_events
  for each row execute function public.communication_events_after_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.specialties enable row level security;
alter table public.profiles enable row level security;
alter table public.bootstrap_admins enable row level security;
alter table public.google_sheet_sources enable row level security;
alter table public.google_sheet_tabs enable row level security;
alter table public.google_sheet_sync_logs enable row level security;
alter table public.doctors enable row level security;
alter table public.doctor_source_rows enable row level security;
alter table public.communication_events enable row level security;
alter table public.patient_feedback enable row level security;
alter table public.audit_logs enable row level security;

create policy departments_read on public.departments for select to authenticated
  using (public.can_access_department(code));

create policy specialties_read on public.specialties for select to authenticated
  using (public.can_access_department(department_code));
create policy specialties_admin on public.specialties for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- bootstrap_admins: no policies -> only service role can read/write.

create policy sheet_sources_admin on public.google_sheet_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sheet_tabs_admin on public.google_sheet_tabs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sync_logs_admin on public.google_sheet_sync_logs for select to authenticated
  using (public.is_admin());

create policy doctors_read on public.doctors for select to authenticated
  using (public.can_access_department(department));
create policy doctors_admin_write on public.doctors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy doctor_source_rows_read on public.doctor_source_rows for select to authenticated
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_source_rows.doctor_id and public.can_access_department(d.department)
  ));

create policy communication_events_read on public.communication_events for select to authenticated
  using (public.can_access_department(department));

create policy patient_feedback_read on public.patient_feedback for select to authenticated
  using (public.can_access_department(department));
create policy patient_feedback_admin_write on public.patient_feedback for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Read models (SECURITY INVOKER, so RLS limits every number to the caller's
-- departments)
-- ---------------------------------------------------------------------------
create or replace function public.doctor_facets()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'departments', coalesce((select jsonb_agg(distinct department) from doctors), '[]'::jsonb),
    'sub_departments', coalesce((
      select jsonb_agg(jsonb_build_object('department', department, 'value', sub_department, 'count', n) order by department, sub_department)
      from (select department, sub_department, count(*) n from doctors where sub_department is not null group by 1, 2) s
    ), '[]'::jsonb),
    'specialties', coalesce((select jsonb_agg(v order by v) from (select distinct specialty v from doctors where specialty is not null) s), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(v order by v) from (select distinct initcap(city_norm) v from doctors where city_norm is not null) s), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(v order by v) from (select distinct category v from doctors where category is not null) s), '[]'::jsonb),
    'bdms', coalesce((select jsonb_agg(v order by v) from (select distinct bdm v from doctors where bdm is not null) s), '[]'::jsonb),
    'nsms', coalesce((select jsonb_agg(v order by v) from (select distinct nsm v from doctors where nsm is not null) s), '[]'::jsonb),
    'contact_statuses', coalesce((select jsonb_agg(v order by v) from (select distinct last_contact_status v from doctors where last_contact_status is not null) s), '[]'::jsonb)
  )
$$;

create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with d as (select * from doctors),
  ev as (select * from communication_events),
  fb as (select * from patient_feedback)
  select jsonb_build_object(
    'total_doctors', (select count(*) from d),
    'by_department', coalesce((select jsonb_object_agg(department, n) from (select department, count(*) n from d group by 1) s), '{}'::jsonb),
    'by_sub_department', coalesce((
      select jsonb_agg(jsonb_build_object('department', department, 'name', coalesce(sub_department, 'Unassigned'), 'count', n) order by n desc)
      from (select department, sub_department, count(*) n from d group by 1, 2) s
    ), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', coalesce(category, 'Not set'), 'count', n) order by category nulls last)
      from (select category, count(*) n from d group by 1) s
    ), '[]'::jsonb),
    'top_cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'count', n) order by n desc)
      from (select initcap(city_norm) city, count(*) n from d where city_norm is not null group by 1 order by 2 desc limit 8) s
    ), '[]'::jsonb),
    'with_email', (select count(*) from d where email_norm is not null),
    'with_phone', (select count(*) from d where phone_norm is not null),
    'data_issue_doctors', (select count(*) from d where jsonb_array_length(data_issues) > 0),
    'emails_sent', (select count(*) from ev where channel = 'EMAIL' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Opened','Clicked','Replied')),
    'emails_failed', (select count(*) from ev where channel = 'EMAIL' and status = 'Failed'),
    'whatsapp_sent', (select count(*) from ev where channel = 'WHATSAPP' and direction = 'OUTBOUND' and status in ('Sent','Delivered','Read','Replied')),
    'replies', (select count(*) from ev where direction = 'INBOUND'),
    'contacted_doctors', (select count(*) from d where last_contact_at is not null or emails_sent > 0),
    'outreach_by_campaign', coalesce((
      select jsonb_agg(jsonb_build_object('campaign', campaign, 'status', status, 'count', n) order by campaign, status)
      from (select coalesce(campaign, event_type) campaign, status, count(*) n from ev group by 1, 2) s
    ), '[]'::jsonb),
    'feedback_total', (select count(*) from fb),
    'feedback_by_status', coalesce((
      select jsonb_object_agg(coalesce(whatsapp_status, 'Pending'), n)
      from (select whatsapp_status, count(*) n from fb group by 1) s
    ), '{}'::jsonb),
    'upcoming_birthdays', (
      select count(*) from d where date_of_birth is not null
        and (
          (to_char(current_date, 'MMDD') <= to_char(current_date + 30, 'MMDD')
            and to_char(date_of_birth, 'MMDD') between to_char(current_date, 'MMDD') and to_char(current_date + 30, 'MMDD'))
          or (to_char(current_date, 'MMDD') > to_char(current_date + 30, 'MMDD')
            and (to_char(date_of_birth, 'MMDD') >= to_char(current_date, 'MMDD')
                 or to_char(date_of_birth, 'MMDD') <= to_char(current_date + 30, 'MMDD')))
        )
    )
  )
$$;

grant execute on function public.doctor_facets() to authenticated;
grant execute on function public.dashboard_summary() to authenticated;
revoke execute on function public.doctor_facets() from anon;
revoke execute on function public.dashboard_summary() from anon;
revoke execute on function public.refresh_doctor_contact(uuid) from anon, authenticated;
