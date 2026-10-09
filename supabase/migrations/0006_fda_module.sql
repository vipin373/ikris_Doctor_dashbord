-- FDA Drug Intelligence + Doctor Communication module.
--
-- Source of truth for drug facts is openFDA (Drugs@FDA + FDA drug labels).
-- Nothing here is AI-generated: classifications record their evidence and
-- source, and anything uncertain is NEEDS_REVIEW and is never offered for
-- sending. Messages keep the exact text that was sent (message_logs is
-- append-only for content) so editing a template never changes history.

-- ------------------------------------------------------------------ helpers
-- Department vocabulary of the FDA module (therapeutic areas) mapped onto the
-- app's access departments (NPP / RARE_DISEASES).
create or replace function app_private.can_access_area(area text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when app_private.current_app_role() = 'ADMIN' then true
    when area is null or area = 'GENERAL' then app_private.current_app_role() is not null
    when area in ('ONCOLOGY', 'HEMATOLOGY', 'NPP') then app_private.current_app_role() = 'NPP'
    when area = 'RARE_DISEASE' then app_private.current_app_role() = 'RARE_DISEASES'
    else false
  end
$$;
grant execute on function app_private.can_access_area(text) to authenticated;

-- Shared secrets for unattended callers (n8n / cron, provider webhooks). Only a
-- SHA-256 hash is stored, in app_settings (admin-only table).
create or replace function app_private.valid_token(p_kind text, p_token text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_token <> '' and exists (
    select 1 from public.app_settings
    where key = p_kind || '_token'
      and value->>'hash' = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ), false)
$$;
revoke all on function app_private.valid_token(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ doctors
alter table public.doctors
  add column if not exists must_see boolean not null default false,
  add column if not exists contact_frequency text
    check (contact_frequency is null or contact_frequency in ('WEEKLY', '15_DAYS', 'MONTHLY', 'CUSTOM')),
  add column if not exists frequency_days integer check (frequency_days is null or frequency_days between 1 and 365),
  add column if not exists last_message_sent_at timestamptz,
  add column if not exists next_eligible_at timestamptz,
  add column if not exists origin text not null default 'sheet' check (origin in ('sheet', 'upload'));

create index if not exists doctors_must_see_idx on public.doctors (must_see) where must_see;

-- ------------------------------------------------------------------ FDA drugs
create table if not exists public.fda_drugs (
  id uuid primary key default gen_random_uuid(),
  application_number text not null unique,          -- NDA/BLA number: the dedupe key
  application_type text,                            -- NDA / BLA
  drug_name text not null,
  brand_name text,
  generic_name text,
  active_ingredient text,
  manufacturer text,
  dosage_form text,
  strength text,
  route text,
  indication text,
  pharm_class text[] not null default '{}',
  therapeutic_area text,                            -- display label of the primary area
  therapeutic_areas text[] not null default '{}',   -- ONCOLOGY / HEMATOLOGY / RARE_DISEASE / OTHER
  department text check (department in ('ONCOLOGY', 'HEMATOLOGY', 'RARE_DISEASE', 'OTHER')),
  classification_status text not null default 'NEEDS_REVIEW'
    check (classification_status in ('CLASSIFIED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
  fda_status text,
  approval_date date,
  latest_action_date date,
  marketing_status text,
  label_set_id text,
  label_effective_date date,
  fda_source text not null,
  fda_source_url text,
  drugs_at_fda_url text,
  label_url text,
  source_last_updated date,                         -- openFDA meta.last_updated
  review_flags jsonb not null default '[]',
  record_hash text,
  retrieved_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(coalesce(drug_name, '') || ' ' || coalesce(brand_name, '') || ' ' || coalesce(generic_name, '') || ' ' ||
          coalesce(active_ingredient, '') || ' ' || coalesce(manufacturer, '') || ' ' || application_number)
  ) stored
);
create index if not exists fda_drugs_department_idx on public.fda_drugs (department, classification_status);
create index if not exists fda_drugs_areas_idx on public.fda_drugs using gin (therapeutic_areas);
create index if not exists fda_drugs_search_idx on public.fda_drugs using gin (search_text extensions.gin_trgm_ops);
create trigger fda_drugs_touch before update on public.fda_drugs
  for each row execute function app_private.touch_updated_at();

create table if not exists public.drug_classifications (
  id bigint generated always as identity primary key,
  drug_id uuid not null references public.fda_drugs (id) on delete cascade,
  department text not null check (department in ('ONCOLOGY', 'HEMATOLOGY', 'RARE_DISEASE', 'OTHER', 'NEEDS_REVIEW')),
  therapeutic_areas text[] not null default '{}',
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  reason text not null,
  evidence text[] not null default '{}',
  source text not null check (source in ('FDA_LABEL_RULES', 'OPENROUTER', 'MANUAL')),
  model text,
  review_status text not null check (review_status in ('AUTO', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
  classified_at timestamptz not null default now(),
  classified_by uuid references auth.users (id)
);
create index if not exists drug_classifications_drug_idx on public.drug_classifications (drug_id, classified_at desc);

create table if not exists public.kegg_drugs (
  id bigint generated always as identity primary key,
  drug_id uuid not null unique references public.fda_drugs (id) on delete cascade,
  kegg_id text not null,
  drug_name text,
  active_ingredient text,
  indication text,
  therapeutic_area text,
  conflict text,                                    -- set when KEGG disagrees with FDA; never merged
  kegg_source_url text not null,
  last_updated timestamptz not null default now()
);

create table if not exists public.fda_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  mode text not null default 'FULL' check (mode in ('FULL', 'INCREMENTAL')),
  trigger text not null default 'MANUAL' check (trigger in ('MANUAL', 'SCHEDULED')),
  triggered_by uuid references auth.users (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  failed_count integer not null default 0,
  fetched_count integer not null default 0,
  cursor jsonb not null default '{}',
  errors jsonb not null default '[]',
  source_last_updated date
);
create index if not exists fda_sync_runs_started_idx on public.fda_sync_runs (started_at desc);

-- ------------------------------------------------------------------ templates
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  department text not null check (department in ('ONCOLOGY', 'HEMATOLOGY', 'RARE_DISEASE', 'NPP', 'GENERAL')),
  channel text not null check (channel in ('WHATSAPP', 'EMAIL', 'BOTH')),
  template_type text not null check (template_type in (
    'FDA_DRUG_UPDATE', 'NEW_DRUG', 'PRODUCT_INFORMATION', 'AVAILABILITY', 'PATIENT_ACCESS',
    'DOCTOR_FOLLOW_UP', 'GENERAL', 'CUSTOM')),
  language text not null default 'en',
  subject text,
  body text not null check (length(body) between 1 and 20000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'INACTIVE')),
  version integer not null default 1,
  -- WhatsApp Business template registered in Cunnekt. Approval is whatever the
  -- provider reports; the app never marks a template approved by itself.
  whatsapp_template_name text,
  whatsapp_template_id text,
  whatsapp_approval_status text not null default 'NOT_SUBMITTED'
    check (whatsapp_approval_status in ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED')),
  whatsapp_variables text[] not null default '{}',  -- our variable for {{1}}, {{2}}, ...
  deleted_at timestamptz,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists message_templates_dept_idx on public.message_templates (department, status) where deleted_at is null;

create table if not exists public.template_versions (
  id bigint generated always as identity primary key,
  template_id uuid not null references public.message_templates (id) on delete cascade,
  version integer not null,
  name text not null,
  channel text not null,
  subject text,
  body text not null,
  whatsapp_template_name text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create or replace function app_private.message_templates_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.body, coalesce(new.subject, ''), new.channel, new.name, coalesce(new.whatsapp_template_name, ''))
       is distinct from (old.body, coalesce(old.subject, ''), old.channel, old.name, coalesce(old.whatsapp_template_name, '')) then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger message_templates_version_bump before update on public.message_templates
  for each row execute function app_private.message_templates_version();

create or replace function app_private.message_templates_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.template_versions (template_id, version, name, channel, subject, body, whatsapp_template_name, created_by)
  values (new.id, new.version, new.name, new.channel, new.subject, new.body, new.whatsapp_template_name,
          coalesce(new.updated_by, new.created_by))
  on conflict (template_id, version) do nothing;
  return null;
end;
$$;
create trigger message_templates_snapshot after insert or update on public.message_templates
  for each row execute function app_private.message_templates_snapshot();

-- ------------------------------------------------------------------ campaigns
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  mode text not null check (mode in ('SINGLE', 'BULK')),
  objective text,
  channel text not null check (channel in ('WHATSAPP', 'EMAIL', 'BOTH')),
  message_method text not null check (message_method in ('TEMPLATE', 'AI', 'MANUAL')),
  drug_mode text not null default 'MANUAL' check (drug_mode in ('AUTO', 'MANUAL')),
  drug_id uuid references public.fda_drugs (id),
  template_id uuid references public.message_templates (id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'SENDING', 'COMPLETED', 'CANCELLED')),
  owner_role text not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_created_idx on public.campaigns (created_at desc);
create trigger campaigns_touch before update on public.campaigns
  for each row execute function app_private.touch_updated_at();

create table if not exists public.campaign_doctors (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  department text not null references public.departments (code),
  drug_id uuid references public.fda_drugs (id),
  match_reason text,
  status text not null default 'PENDING' check (status in ('PENDING', 'GENERATED', 'SKIPPED')),
  skip_reason text,
  upload_row jsonb,
  unique (campaign_id, doctor_id)
);
create index if not exists campaign_doctors_campaign_idx on public.campaign_doctors (campaign_id, status);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  purpose text not null check (purpose in ('MESSAGE', 'CLASSIFICATION')),
  doctor_id uuid references public.doctors (id) on delete set null,
  drug_id uuid references public.fda_drugs (id) on delete set null,
  model text not null,
  prompt_version text not null,
  input_data_reference jsonb not null default '{}',  -- ids and field names only, no raw contact data
  generated_text text,
  status text not null check (status in ('OK', 'NEEDS_REVIEW', 'FAILED')),
  error text,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_runs_created_idx on public.ai_runs (created_at desc);

create table if not exists public.generated_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_doctor_id bigint references public.campaign_doctors (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  department text not null references public.departments (code),
  drug_id uuid references public.fda_drugs (id),
  channel text not null check (channel in ('WHATSAPP', 'EMAIL')),
  method text not null check (method in ('TEMPLATE', 'AI', 'MANUAL')),
  template_id uuid references public.message_templates (id),
  template_version integer,
  ai_run_id uuid references public.ai_runs (id),
  subject text,
  body text not null default '',
  whatsapp_params text[] not null default '{}',
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'SENT', 'FAILED')),
  issues jsonb not null default '[]',
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_doctor_id, channel)
);
create index if not exists generated_messages_campaign_idx on public.generated_messages (campaign_id, status);
create trigger generated_messages_touch before update on public.generated_messages
  for each row execute function app_private.touch_updated_at();

create table if not exists public.message_logs (
  id bigint generated always as identity primary key,
  generated_message_id uuid references public.generated_messages (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  department text not null references public.departments (code),
  drug_id uuid references public.fda_drugs (id),
  channel text not null check (channel in ('WHATSAPP', 'EMAIL')),
  template_id uuid references public.message_templates (id),
  template_version integer,
  recipient text not null,
  subject text,
  message_text text not null,
  provider text not null check (provider in ('CUNNEKT', 'SMTP')),
  provider_message_id text,
  provider_response jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REJECTED')),
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists message_logs_doctor_idx on public.message_logs (doctor_id, created_at desc);
create index if not exists message_logs_provider_idx on public.message_logs (provider_message_id) where provider_message_id is not null;
create index if not exists message_logs_created_idx on public.message_logs (created_at desc);

-- What was sent can never be edited afterwards.
create or replace function app_private.message_logs_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.message_text, coalesce(new.subject, ''), new.recipient, new.channel, new.doctor_id, coalesce(new.drug_id::text, ''))
     is distinct from (old.message_text, coalesce(old.subject, ''), old.recipient, old.channel, old.doctor_id, coalesce(old.drug_id::text, '')) then
    raise exception 'Sent messages cannot be changed';
  end if;
  return new;
end;
$$;
create trigger message_logs_immutable before update on public.message_logs
  for each row execute function app_private.message_logs_immutable();

create table if not exists public.message_status_events (
  id bigint generated always as identity primary key,
  message_log_id bigint references public.message_logs (id) on delete cascade,
  provider text not null,
  provider_message_id text not null,
  status text not null,
  payload jsonb not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists message_status_events_log_idx on public.message_status_events (message_log_id);

-- ------------------------------------------------------------------ settings
-- fda_settings: {schedule: daily|weekly|manual, sender: {name, phone, email}}
insert into public.app_settings (key, value) values
  ('fda_settings', '{"schedule": "weekly", "sender": {"name": "Ikris Pharma Network", "phone": "", "email": ""}}')
on conflict (key) do nothing;
create policy app_settings_read_fda on public.app_settings for select to authenticated
  using (key = 'fda_settings');

-- ------------------------------------------------------------------ RLS
alter table public.fda_drugs enable row level security;
alter table public.drug_classifications enable row level security;
alter table public.kegg_drugs enable row level security;
alter table public.fda_sync_runs enable row level security;
alter table public.message_templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_doctors enable row level security;
alter table public.ai_runs enable row level security;
alter table public.generated_messages enable row level security;
alter table public.message_logs enable row level security;
alter table public.message_status_events enable row level security;

-- FDA reference data: everyone signed in reads, Admin writes.
create policy fda_drugs_read on public.fda_drugs for select to authenticated using (app_private.current_app_role() is not null);
create policy fda_drugs_admin on public.fda_drugs for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy drug_classifications_read on public.drug_classifications for select to authenticated using (app_private.current_app_role() is not null);
create policy drug_classifications_admin on public.drug_classifications for insert to authenticated
  with check (app_private.is_admin() and classified_by = auth.uid());
create policy kegg_drugs_read on public.kegg_drugs for select to authenticated using (app_private.current_app_role() is not null);
create policy kegg_drugs_admin on public.kegg_drugs for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy fda_sync_runs_read on public.fda_sync_runs for select to authenticated using (app_private.current_app_role() is not null);
create policy fda_sync_runs_admin on public.fda_sync_runs for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin());

-- Templates: by therapeutic area / department.
create policy message_templates_read on public.message_templates for select to authenticated
  using (app_private.can_access_area(department));
create policy message_templates_insert on public.message_templates for insert to authenticated
  with check (app_private.can_access_area(department) and created_by = auth.uid());
create policy message_templates_update on public.message_templates for update to authenticated
  using (app_private.can_access_area(department) and (department <> 'GENERAL' or app_private.is_admin() or created_by = auth.uid()))
  with check (app_private.can_access_area(department));
create policy template_versions_read on public.template_versions for select to authenticated
  using (exists (select 1 from public.message_templates t where t.id = template_id and app_private.can_access_area(t.department)));

-- Campaigns: the creator's department (Admin sees all).
create policy campaigns_access on public.campaigns for all to authenticated
  using (app_private.is_admin() or owner_role = app_private.current_app_role()::text)
  with check (app_private.is_admin() or owner_role = app_private.current_app_role()::text);
create policy campaign_doctors_access on public.campaign_doctors for all to authenticated
  using (app_private.can_access_department(department)) with check (app_private.can_access_department(department));
create policy generated_messages_access on public.generated_messages for all to authenticated
  using (app_private.can_access_department(department)) with check (app_private.can_access_department(department));
create policy message_logs_read on public.message_logs for select to authenticated
  using (app_private.can_access_department(department));
create policy message_logs_insert on public.message_logs for insert to authenticated
  with check (app_private.can_access_department(department) and created_by = auth.uid());
create policy message_logs_update on public.message_logs for update to authenticated
  using (app_private.can_access_department(department) and created_by = auth.uid())
  with check (app_private.can_access_department(department));
create policy message_status_events_read on public.message_status_events for select to authenticated
  using (exists (select 1 from public.message_logs l where l.id = message_log_id and app_private.can_access_department(l.department)));
create policy ai_runs_insert on public.ai_runs for insert to authenticated with check (user_id = auth.uid());
create policy ai_runs_read on public.ai_runs for select to authenticated using (app_private.is_admin() or user_id = auth.uid());

-- ------------------------------------------------------------------ RPCs
-- Must See / contact frequency for one doctor (department users may set these).
create or replace function public.set_doctor_outreach(
  p_doctor uuid, p_must_see boolean, p_frequency text, p_days integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
  v_days integer;
begin
  select department into v_dept from doctors where id = p_doctor;
  if v_dept is null or not app_private.can_access_department(v_dept) then
    raise exception 'Doctor not found' using errcode = 'P0002';
  end if;
  v_days := case p_frequency when 'WEEKLY' then 7 when '15_DAYS' then 15 when 'MONTHLY' then 30
                             when 'CUSTOM' then p_days else null end;
  if p_frequency = 'CUSTOM' and (v_days is null or v_days < 1 or v_days > 365) then
    raise exception 'Custom frequency needs 1 to 365 days' using errcode = '22023';
  end if;
  update doctors set
    must_see = coalesce(p_must_see, must_see),
    contact_frequency = p_frequency,
    frequency_days = v_days,
    next_eligible_at = case when v_days is null then null
                            when last_message_sent_at is null then null
                            else last_message_sent_at + make_interval(days => v_days) end
  where id = p_doctor;
end;
$$;
revoke all on function public.set_doctor_outreach(uuid, boolean, text, integer) from public, anon;
grant execute on function public.set_doctor_outreach(uuid, boolean, text, integer) to authenticated;

-- Add doctors confirmed from a bulk upload. Rows: [{department, dedupe_key, doctor_name, ...}].
-- Existing doctors (same department + dedupe key) are returned, never duplicated.
create or replace function public.fda_add_doctors(p_rows jsonb)
returns table (idx integer, doctor_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  i integer := 0;
  v_id uuid;
  v_new boolean;
  v_days integer;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    if not app_private.can_access_department(r->>'department') then
      raise exception 'You cannot add doctors to %', r->>'department' using errcode = '42501';
    end if;
    v_days := case r->>'contact_frequency' when 'WEEKLY' then 7 when '15_DAYS' then 15 when 'MONTHLY' then 30
                   when 'CUSTOM' then nullif(r->>'frequency_days', '')::int else null end;
    select d.id into v_id from doctors d where d.department = r->>'department' and d.dedupe_key = r->>'dedupe_key';
    v_new := v_id is null;
    if v_new then
      insert into doctors (
        department, sub_department, dedupe_key, doctor_name, specialty, institute, city, state, country,
        contact_number, whatsapp_number, email, email_norm, phone_norm, name_norm, city_norm,
        must_see, contact_frequency, frequency_days, origin, extra, data_issues
      ) values (
        r->>'department', nullif(r->>'sub_department', ''), r->>'dedupe_key', r->>'doctor_name',
        nullif(r->>'specialty', ''), nullif(r->>'institute', ''), nullif(r->>'city', ''), nullif(r->>'state', ''),
        nullif(r->>'country', ''), nullif(r->>'whatsapp_number', ''), nullif(r->>'whatsapp_number', ''),
        nullif(r->>'email', ''), nullif(r->>'email_norm', ''), nullif(r->>'phone_norm', ''),
        nullif(r->>'name_norm', ''), nullif(lower(r->>'city'), ''),
        coalesce((r->>'must_see')::boolean, false), nullif(r->>'contact_frequency', ''), v_days, 'upload',
        jsonb_build_object('notes', r->>'notes', 'active', r->>'active', 'added_via', 'FDA bulk upload'),
        '[]'::jsonb
      ) returning id into v_id;
    elsif r ? 'must_see' or r ? 'contact_frequency' then
      update doctors set
        must_see = coalesce((r->>'must_see')::boolean, must_see),
        contact_frequency = coalesce(nullif(r->>'contact_frequency', ''), contact_frequency),
        frequency_days = coalesce(v_days, frequency_days)
      where id = v_id;
    end if;
    idx := i; doctor_id := v_id; created := v_new;
    return next;
    i := i + 1;
  end loop;
end;
$$;
revoke all on function public.fda_add_doctors(jsonb) from public, anon;
grant execute on function public.fda_add_doctors(jsonb) to authenticated;

-- After the provider accepted a message: start the doctor's frequency window
-- and add it to the doctor's communication history.
create or replace function public.fda_record_send(p_log_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_drug text;
begin
  select * into l from message_logs where id = p_log_id;
  if l.id is null or not app_private.can_access_department(l.department) or l.created_by <> auth.uid() then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if l.status not in ('SENT', 'DELIVERED', 'READ') then
    return;
  end if;
  update doctors set
    last_message_sent_at = l.sent_at,
    next_eligible_at = case when frequency_days is null then null else l.sent_at + make_interval(days => frequency_days) end
  where id = l.doctor_id and (last_message_sent_at is null or last_message_sent_at < l.sent_at);
  select drug_name into v_drug from fda_drugs where id = l.drug_id;
  insert into communication_events (doctor_id, department, channel, direction, event_type, status, subject, detail,
                                    campaign, occurred_at, source, external_key)
  values (l.doctor_id, l.department, l.channel, 'OUTBOUND', 'FDA drug communication', 'Sent', l.subject,
          left(l.message_text, 500), 'FDA' || coalesce(': ' || v_drug, ''), l.sent_at, 'fda_module', 'fda:' || l.id)
  on conflict (external_key) do nothing;
end;
$$;
revoke all on function public.fda_record_send(bigint) from public, anon;
grant execute on function public.fda_record_send(bigint) to authenticated;

-- Delivery receipts from the WhatsApp provider webhook. p_events:
-- [{provider_message_id, status: SENT|DELIVERED|READ|FAILED, occurred_at, error, payload}]
create or replace function public.fda_record_status(p_token text, p_events jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  n integer := 0;
  l record;
  v_status text;
  v_rank integer;
begin
  if not app_private.valid_token('webhook', p_token) then
    raise exception 'Invalid webhook token' using errcode = '42501';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    v_status := upper(e->>'status');
    if v_status not in ('SENT', 'DELIVERED', 'READ', 'FAILED') then continue; end if;
    select * into l from message_logs where provider_message_id = e->>'provider_message_id' order by id desc limit 1;
    insert into message_status_events (message_log_id, provider, provider_message_id, status, payload, occurred_at)
    values (l.id, 'CUNNEKT', e->>'provider_message_id', v_status, coalesce(e->'payload', '{}'),
            nullif(e->>'occurred_at', '')::timestamptz);
    if l.id is null then continue; end if;
    -- Statuses only move forward (a late "delivered" never overrides "read").
    v_rank := case l.status when 'QUEUED' then 0 when 'SENT' then 1 when 'DELIVERED' then 2 when 'READ' then 3 else 4 end;
    if v_status = 'FAILED' or (case v_status when 'SENT' then 1 when 'DELIVERED' then 2 when 'READ' then 3 end) > v_rank then
      update message_logs set
        status = v_status,
        error = case when v_status = 'FAILED' then coalesce(e->>'error', error) else error end,
        delivered_at = case when v_status in ('DELIVERED', 'READ') then coalesce(delivered_at, nullif(e->>'occurred_at', '')::timestamptz, now()) else delivered_at end,
        read_at = case when v_status = 'READ' then coalesce(nullif(e->>'occurred_at', '')::timestamptz, now()) else read_at end,
        failed_at = case when v_status = 'FAILED' then coalesce(nullif(e->>'occurred_at', '')::timestamptz, now()) else failed_at end
      where id = l.id;
      update communication_events set status = initcap(lower(v_status)) where external_key = 'fda:' || l.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.fda_record_status(text, jsonb) from public;
grant execute on function public.fda_record_status(text, jsonb) to anon, authenticated;

-- Writes from the FDA sync: by an Admin session or by the automation token
-- (n8n / scheduled runs). p_drugs rows carry the drug fields plus a
-- "classification" object. Returns counts. A drug's manual (reviewed)
-- classification is never overwritten by a sync.
create or replace function public.fda_sync_write(p_token text, p_drugs jsonb, p_source_last_updated date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  c jsonb;
  v_old record;
  v_id uuid;
  v_new integer := 0;
  v_upd integer := 0;
  v_same integer := 0;
  v_manual boolean;
begin
  if not (app_private.is_admin() or app_private.valid_token('automation', p_token)) then
    raise exception 'Not allowed to sync FDA data' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p_drugs) loop
    c := r->'classification';
    v_old := null;
    select id, record_hash into v_old from fda_drugs where application_number = r->>'application_number';
    if v_old.id is not null and v_old.record_hash = r->>'record_hash' then
      update fda_drugs set last_synced_at = now(), source_last_updated = p_source_last_updated where id = v_old.id;
      v_same := v_same + 1;
      continue;
    end if;
    select exists (select 1 from drug_classifications dc where dc.drug_id = v_old.id and dc.source = 'MANUAL')
      into v_manual;
    insert into fda_drugs as d (
      application_number, application_type, drug_name, brand_name, generic_name, active_ingredient, manufacturer,
      dosage_form, strength, route, indication, pharm_class, therapeutic_area, therapeutic_areas, department,
      classification_status, fda_status, approval_date, latest_action_date, marketing_status, label_set_id,
      label_effective_date, fda_source, fda_source_url, drugs_at_fda_url, label_url, source_last_updated,
      review_flags, record_hash, retrieved_at, last_synced_at
    ) values (
      r->>'application_number', r->>'application_type', r->>'drug_name', r->>'brand_name', r->>'generic_name',
      r->>'active_ingredient', r->>'manufacturer', r->>'dosage_form', r->>'strength', r->>'route', r->>'indication',
      coalesce(array(select jsonb_array_elements_text(r->'pharm_class')), '{}'),
      c->>'therapeutic_area', coalesce(array(select jsonb_array_elements_text(c->'therapeutic_areas')), '{}'),
      nullif(c->>'department', 'NEEDS_REVIEW'),
      case when c->>'review_status' = 'AUTO' then 'CLASSIFIED' else 'NEEDS_REVIEW' end,
      r->>'fda_status', nullif(r->>'approval_date', '')::date, nullif(r->>'latest_action_date', '')::date,
      r->>'marketing_status', r->>'label_set_id', nullif(r->>'label_effective_date', '')::date,
      r->>'fda_source', r->>'fda_source_url', r->>'drugs_at_fda_url', r->>'label_url', p_source_last_updated,
      coalesce(r->'review_flags', '[]'), r->>'record_hash', now(), now()
    )
    on conflict (application_number) do update set
      application_type = excluded.application_type, drug_name = excluded.drug_name, brand_name = excluded.brand_name,
      generic_name = excluded.generic_name, active_ingredient = excluded.active_ingredient,
      manufacturer = excluded.manufacturer, dosage_form = excluded.dosage_form, strength = excluded.strength,
      route = excluded.route, indication = excluded.indication, pharm_class = excluded.pharm_class,
      therapeutic_area = case when v_manual then d.therapeutic_area else excluded.therapeutic_area end,
      therapeutic_areas = case when v_manual then d.therapeutic_areas else excluded.therapeutic_areas end,
      department = case when v_manual then d.department else excluded.department end,
      classification_status = case when v_manual then d.classification_status else excluded.classification_status end,
      fda_status = excluded.fda_status, approval_date = excluded.approval_date,
      latest_action_date = excluded.latest_action_date, marketing_status = excluded.marketing_status,
      label_set_id = excluded.label_set_id, label_effective_date = excluded.label_effective_date,
      fda_source = excluded.fda_source, fda_source_url = excluded.fda_source_url,
      drugs_at_fda_url = excluded.drugs_at_fda_url, label_url = excluded.label_url,
      source_last_updated = excluded.source_last_updated, review_flags = excluded.review_flags,
      record_hash = excluded.record_hash, retrieved_at = now(), last_synced_at = now()
    returning id into v_id;
    if not coalesce(v_manual, false) and c is not null then
      insert into drug_classifications (drug_id, department, therapeutic_areas, confidence, reason, evidence, source, model, review_status)
      values (v_id, c->>'department', coalesce(array(select jsonb_array_elements_text(c->'therapeutic_areas')), '{}'),
              (c->>'confidence')::numeric, c->>'reason',
              coalesce(array(select jsonb_array_elements_text(c->'evidence')), '{}'),
              c->>'source', c->>'model', c->>'review_status');
    end if;
    if v_old.id is null then v_new := v_new + 1; else v_upd := v_upd + 1; end if;
  end loop;
  return jsonb_build_object('new', v_new, 'updated', v_upd, 'unchanged', v_same);
end;
$$;
revoke all on function public.fda_sync_write(text, jsonb, date) from public;
grant execute on function public.fda_sync_write(text, jsonb, date) to anon, authenticated;

-- Sync run bookkeeping for the token path (Admin sessions can also use it).
create or replace function public.fda_sync_run_save(p_token text, p_run jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_run->>'id', '')::uuid;
begin
  if not (app_private.is_admin() or app_private.valid_token('automation', p_token)) then
    raise exception 'Not allowed to sync FDA data' using errcode = '42501';
  end if;
  if v_id is null then
    insert into fda_sync_runs (mode, trigger, triggered_by, cursor)
    values (coalesce(p_run->>'mode', 'FULL'), coalesce(p_run->>'trigger', 'MANUAL'), auth.uid(), coalesce(p_run->'cursor', '{}'))
    returning id into v_id;
  else
    update fda_sync_runs set
      status = coalesce(p_run->>'status', status),
      finished_at = case when p_run ? 'finished' then now() else finished_at end,
      new_count = new_count + coalesce((p_run->>'new')::int, 0),
      updated_count = updated_count + coalesce((p_run->>'updated')::int, 0),
      unchanged_count = unchanged_count + coalesce((p_run->>'unchanged')::int, 0),
      failed_count = failed_count + coalesce((p_run->>'failed')::int, 0),
      fetched_count = fetched_count + coalesce((p_run->>'fetched')::int, 0),
      cursor = coalesce(p_run->'cursor', cursor),
      errors = case when p_run ? 'errors' then (errors || (p_run->'errors'))
                    else errors end,
      source_last_updated = coalesce(nullif(p_run->>'source_last_updated', '')::date, source_last_updated)
    where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.fda_sync_run_save(text, jsonb) from public;
grant execute on function public.fda_sync_run_save(text, jsonb) to anon, authenticated;

-- What a scheduled caller needs: schedule, last successful run, unfinished run.
create or replace function public.fda_sync_context(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_private.is_admin() or app_private.valid_token('automation', p_token)) then
    raise exception 'Not allowed to sync FDA data' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select value from app_settings where key = 'fda_settings'),
    'last_success', (select to_jsonb(r) from fda_sync_runs r where status in ('SUCCESS', 'PARTIAL') order by started_at desc limit 1),
    'running', (select to_jsonb(r) from fda_sync_runs r where status = 'RUNNING' and started_at > now() - interval '6 hours'
                order by started_at desc limit 1),
    'drug_count', (select count(*) from fda_drugs)
  );
end;
$$;
revoke all on function public.fda_sync_context(text) from public;
grant execute on function public.fda_sync_context(text) to anon, authenticated;

-- Dashboard numbers for the FDA page.
create or replace function public.fda_overview()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', (select count(*) from fda_drugs),
    'by_department', coalesce((select jsonb_object_agg(coalesce(department, 'NEEDS_REVIEW'), n)
                                from (select department, count(*) n from fda_drugs group by 1) s), '{}'),
    'needs_review', (select count(*) from fda_drugs where classification_status = 'NEEDS_REVIEW'),
    'last_sync', (select to_jsonb(r) - 'cursor' from fda_sync_runs r order by started_at desc limit 1),
    'last_success', (select max(finished_at) from fda_sync_runs where status in ('SUCCESS', 'PARTIAL'))
  )
$$;
grant execute on function public.fda_overview() to authenticated;
revoke execute on function public.fda_overview() from anon;
