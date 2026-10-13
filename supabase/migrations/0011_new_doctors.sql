-- New Doctors (Apollo-found leads, "IKRIS Doctor Mailer" sheet).
-- Deliberately isolated: its own table, never merged into public.doctors,
-- never counted in the dashboard, reminders, campaigns or FDA matching.

create table if not exists public.new_doctors (
  id            bigint generated always as identity primary key,
  row_key       text not null unique,
  sheet_row     integer,
  department    text not null default 'NPP' check (department in ('NPP', 'RARE_DISEASES')),
  doctor_name   text not null,
  specialty     text,
  sub_department text,
  hospital      text,
  city          text,
  email         text,
  status        text,
  sent_at       timestamptz,
  sent_date_raw text,
  subject_used  text,
  error         text,
  follow_up     text,
  thread_id     text,
  extra         jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists new_doctors_sent_at_idx on public.new_doctors (sent_at desc);
create index if not exists new_doctors_email_idx on public.new_doctors (lower(email));

alter table public.new_doctors enable row level security;

drop policy if exists new_doctors_read on public.new_doctors;
create policy new_doctors_read on public.new_doctors
  for select to authenticated
  using (app_private.can_access_department(department));

-- Users who can see the list can refresh it from the sheet (the sheet is the
-- source of truth; the table is a mirror).
drop policy if exists new_doctors_insert on public.new_doctors;
create policy new_doctors_insert on public.new_doctors
  for insert to authenticated
  with check (app_private.can_access_department(department));

drop policy if exists new_doctors_update on public.new_doctors;
create policy new_doctors_update on public.new_doctors
  for update to authenticated
  using (app_private.can_access_department(department))
  with check (app_private.can_access_department(department));

drop policy if exists new_doctors_delete on public.new_doctors;
create policy new_doctors_delete on public.new_doctors
  for delete to authenticated
  using (app_private.can_access_department(department));

grant select, insert, update, delete on public.new_doctors to authenticated;
revoke all on public.new_doctors from anon;
