-- International Drug Intelligence: drug master, per-country approval records,
-- indications, regulatory history (audit), import runs, doctor–drug mapping and
-- NPP drug requests.
--
-- Rules enforced here
-- * One approval record per drug and jurisdiction (never several countries in one field).
-- * Approval status is one of 8 controlled values. A missing record is shown as
--   "Not Verified" by the app; it never means "not approved".
-- * Every status/date change is written to intl_drug_history by a trigger.
-- * Manually verified records are locked: source imports never overwrite them.
-- * NPP requests hold only a pseudonymous patient reference, visible to the
--   assigned department and Admin only.

create sequence if not exists public.intl_drug_seq;
create sequence if not exists public.intl_approval_seq;
create sequence if not exists public.intl_history_seq;
create sequence if not exists public.npp_drug_request_seq;

create table if not exists public.intl_drugs (
  id                      text primary key default ('IDI-' || lpad(nextval('public.intl_drug_seq')::text, 6, '0')),
  match_key               text not null unique,
  kegg_drug_id            text unique check (kegg_drug_id ~ '^D[0-9]{5}$'),
  generic_name            text not null check (length(trim(generic_name)) > 0),
  brand_names             text[] not null default '{}',
  alternative_names       text[] not null default '{}',
  active_ingredient       text,
  combination_ingredients text[] not null default '{}',
  therapeutic_area        text,
  sub_therapeutic_area    text,
  drug_class              text,
  atc_code                text,
  dosage_form             text,
  strength                text,
  route                   text,
  manufacturer            text,
  mah                     text,
  indication              text,
  orphan_eu               boolean,
  orphan_us               boolean,
  orphan_jp               boolean,
  drug_type               text,
  is_oncology             boolean not null default false,
  is_rare                 boolean not null default false,
  source_url              text,
  verification_status     text not null default 'Source-imported'
                          check (verification_status in ('Verified', 'Source-imported', 'Needs Review', 'Not Verified')),
  locked                  boolean not null default false,
  search_text             text not null default '',
  created_by              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists intl_drugs_search_idx on public.intl_drugs using gin (search_text extensions.gin_trgm_ops);
create index if not exists intl_drugs_area_idx on public.intl_drugs (therapeutic_area);

create table if not exists public.intl_drug_approvals (
  id                  text primary key default ('APR-' || lpad(nextval('public.intl_approval_seq')::text, 7, '0')),
  drug_id             text not null references public.intl_drugs(id) on delete cascade,
  country             text not null check (country ~ '^[A-Z]{2}$'),
  region              text not null check (region in ('USA', 'Europe', 'Japan', 'Other')),
  authority           text,
  approval_status     text not null check (approval_status in
                        ('Approved', 'Under Review', 'Withdrawn', 'Suspended', 'Refused', 'Expired',
                         'Not Verified', 'No Approval Record Found')),
  approval_date       date,
  application_number  text,
  ma_number           text,
  approval_type       text,
  indication_approved text,
  label_url           text,
  source_url          text,
  marketing_status    text,
  source_checked      text,
  search_terms        text,
  last_verified_date  date,
  verified_by         text,
  verification_notes  text,
  data_origin         text not null default 'Manual' check (data_origin in ('openFDA', 'EMA', 'CSV import', 'Manual')),
  locked              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (drug_id, country)
);
create index if not exists intl_drug_approvals_status_idx on public.intl_drug_approvals (country, approval_status);

create table if not exists public.intl_drug_indications (
  id                  bigint generated always as identity primary key,
  drug_id             text not null references public.intl_drugs(id) on delete cascade,
  indication          text not null,
  disease_category    text,
  therapeutic_area    text,
  country             text not null check (country ~ '^[A-Z]{2}$'),
  approval_status     text,
  approval_date       date,
  source_url          text,
  verification_status text not null default 'Source-imported',
  indication_hash     text generated always as (md5(lower(indication))) stored,
  created_at          timestamptz not null default now(),
  unique (drug_id, country, indication_hash)
);

create table if not exists public.intl_drug_history (
  id               text primary key default ('HIS-' || lpad(nextval('public.intl_history_seq')::text, 8, '0')),
  drug_id          text not null references public.intl_drugs(id) on delete cascade,
  country          text,
  authority        text,
  previous_status  text,
  new_status       text,
  effective_date   date,
  description      text,
  source_url       text,
  changed_by       text,
  updated_on       timestamptz not null default now()
);
create index if not exists intl_drug_history_drug_idx on public.intl_drug_history (drug_id, updated_on desc);

create table if not exists public.intl_import_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  status      text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  counts      jsonb not null default '{}'::jsonb,
  errors      jsonb not null default '[]'::jsonb,
  started_by  text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.doctor_drug_mappings (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references public.doctors(id) on delete cascade,
  drug_id     text not null references public.intl_drugs(id) on delete cascade,
  basis       text,
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (doctor_id, drug_id)
);
create index if not exists doctor_drug_mappings_drug_idx on public.doctor_drug_mappings (drug_id);

create table if not exists public.npp_drug_requests (
  id                       text primary key default ('REQ-' || lpad(nextval('public.npp_drug_request_seq')::text, 6, '0')),
  patient_reference_id     text check (patient_reference_id ~ '^[A-Za-z0-9/_-]{1,40}$'),
  doctor_id                uuid references public.doctors(id) on delete set null,
  drug_id                  text references public.intl_drugs(id) on delete set null,
  requested_drug_name      text not null check (length(trim(requested_drug_name)) > 0),
  generic_name             text,
  brand_name               text,
  strength                 text,
  dosage_form              text,
  required_country         text,
  treating_doctor          text,
  request_date             date not null default current_date,
  request_status           text not null default 'New' check (request_status in
                             ('New', 'Regulatory check', 'Sourcing', 'Awaiting documents', 'Approved by compliance',
                              'Fulfilled', 'Closed', 'Cancelled')),
  regulatory_check_status  text not null default 'Not started' check (regulatory_check_status in
                             ('Not started', 'In progress', 'Approval verified', 'No approval record found',
                              'Referred to compliance', 'Completed')),
  approval_check           text not null default 'Not checked',
  marketing_check          text not null default 'Not checked',
  stock_check              text not null default 'Not checked',
  import_check             text not null default 'Not checked',
  patient_permission_check text not null default 'Not checked',
  assigned_department      text not null references public.departments(code),
  remarks                  text,
  created_by               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (approval_check in ('Not checked', 'Pending', 'Confirmed', 'Not available', 'Not applicable')),
  check (marketing_check in ('Not checked', 'Pending', 'Confirmed', 'Not available', 'Not applicable')),
  check (stock_check in ('Not checked', 'Pending', 'Confirmed', 'Not available', 'Not applicable')),
  check (import_check in ('Not checked', 'Pending', 'Confirmed', 'Not available', 'Not applicable')),
  check (patient_permission_check in ('Not checked', 'Pending', 'Confirmed', 'Not available', 'Not applicable'))
);
create index if not exists npp_drug_requests_drug_idx on public.npp_drug_requests (drug_id);

-- ---------------------------------------------------------------- triggers
create or replace function app_private.intl_drug_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ', new.id, new.generic_name, array_to_string(new.brand_names, ' '),
    array_to_string(new.alternative_names, ' '), new.active_ingredient, new.kegg_drug_id, new.manufacturer, new.mah,
    new.therapeutic_area, new.sub_therapeutic_area, new.atc_code, left(new.indication, 2000)));
  return new;
end $$;
drop trigger if exists intl_drugs_touch on public.intl_drugs;
create trigger intl_drugs_touch before insert or update on public.intl_drugs
  for each row execute function app_private.intl_drug_touch();

create or replace function app_private.intl_approval_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(nullif(current_setting('app.intl_actor', true), ''), (select email from auth.users where id = auth.uid()));
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    insert into intl_drug_history (drug_id, country, authority, previous_status, new_status, effective_date, description, source_url, changed_by)
    values (new.drug_id, new.country, new.authority, null, new.approval_status, new.approval_date,
            'Record created (' || new.data_origin || ')', new.source_url, who);
  elsif new.approval_status is distinct from old.approval_status or new.approval_date is distinct from old.approval_date then
    insert into intl_drug_history (drug_id, country, authority, previous_status, new_status, effective_date, description, source_url, changed_by)
    values (new.drug_id, new.country, new.authority, old.approval_status, new.approval_status, new.approval_date,
            case when new.approval_status is distinct from old.approval_status then 'Status changed' else 'Approval date changed from ' || coalesce(old.approval_date::text, 'blank') end
              || ' (' || new.data_origin || ')', new.source_url, who);
  end if;
  return new;
end $$;
drop trigger if exists intl_approvals_history on public.intl_drug_approvals;
create trigger intl_approvals_history before insert or update on public.intl_drug_approvals
  for each row execute function app_private.intl_approval_history();

-- ---------------------------------------------------------------- RLS
alter table public.intl_drugs enable row level security;
alter table public.intl_drug_approvals enable row level security;
alter table public.intl_drug_indications enable row level security;
alter table public.intl_drug_history enable row level security;
alter table public.intl_import_runs enable row level security;
alter table public.doctor_drug_mappings enable row level security;
alter table public.npp_drug_requests enable row level security;

do $$
declare t text;
begin
  foreach t in array array['intl_drugs', 'intl_drug_approvals', 'intl_drug_indications', 'intl_drug_history', 'intl_import_runs'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app_private.current_app_role() is not null)', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin())', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
    execute format('revoke all on public.%1$s from anon', t);
  end loop;
end $$;

drop policy if exists doctor_drug_mappings_all on public.doctor_drug_mappings;
create policy doctor_drug_mappings_all on public.doctor_drug_mappings for all to authenticated
  using (exists (select 1 from public.doctors d where d.id = doctor_id and app_private.can_access_department(d.department)))
  with check (exists (select 1 from public.doctors d where d.id = doctor_id and app_private.can_access_department(d.department)));
grant select, insert, update, delete on public.doctor_drug_mappings to authenticated;
revoke all on public.doctor_drug_mappings from anon;

drop policy if exists npp_drug_requests_all on public.npp_drug_requests;
create policy npp_drug_requests_all on public.npp_drug_requests for all to authenticated
  using (app_private.can_access_department(assigned_department))
  with check (app_private.can_access_department(assigned_department));
grant select, insert, update, delete on public.npp_drug_requests to authenticated;
revoke all on public.npp_drug_requests from anon;
grant usage on sequence public.npp_drug_request_seq to authenticated;
grant usage on sequence public.intl_drug_seq, public.intl_approval_seq, public.intl_history_seq to authenticated;

-- ---------------------------------------------------------------- overview view
create or replace view public.intl_drug_overview with (security_invoker = true) as
select d.id, d.kegg_drug_id, d.generic_name, d.brand_names, d.active_ingredient, d.therapeutic_area, d.sub_therapeutic_area,
       d.atc_code, d.manufacturer, d.mah, d.orphan_eu, d.orphan_us, d.orphan_jp,
       (coalesce(d.orphan_eu, false) or coalesce(d.orphan_us, false) or coalesce(d.orphan_jp, false)) as is_orphan,
       d.is_oncology, d.is_rare, d.drug_type, d.verification_status, d.search_text, d.updated_at,
       us.approval_status as us_status, us.approval_date as us_date,
       eu.approval_status as eu_status, eu.approval_date as eu_date,
       gb.approval_status as uk_status,
       jp.approval_status as jp_status, jp.approval_date as jp_date,
       coalesce(a.approved_regions, 0) as approved_regions,
       coalesce(a.country_status, '{}') as country_status,
       coalesce(a.region_status, '{}') as region_status,
       coalesce(a.authorities, '{}') as authorities,
       coalesce(a.approval_years, '{}') as approval_years,
       a.first_approval_date, a.latest_approval_date, a.last_verified,
       coalesce(a.not_verified, 0) > 0 or d.verification_status in ('Needs Review', 'Not Verified') as pending_verification,
       (select count(*) from public.doctor_drug_mappings m where m.drug_id = d.id) as mapped_doctors
from public.intl_drugs d
left join public.intl_drug_approvals us on us.drug_id = d.id and us.country = 'US'
left join public.intl_drug_approvals eu on eu.drug_id = d.id and eu.country = 'EU'
left join public.intl_drug_approvals gb on gb.drug_id = d.id and gb.country = 'GB'
left join public.intl_drug_approvals jp on jp.drug_id = d.id and jp.country = 'JP'
left join lateral (
  select count(distinct x.region) filter (where x.approval_status = 'Approved') as approved_regions,
         array_agg(x.country || ':' || x.approval_status) as country_status,
         array_agg(distinct x.region || ':' || x.approval_status) as region_status,
         array_agg(distinct x.authority) filter (where x.authority is not null) as authorities,
         array_agg(distinct extract(year from x.approval_date)::int) filter (where x.approval_date is not null and x.approval_status = 'Approved') as approval_years,
         min(x.approval_date) filter (where x.approval_status = 'Approved') as first_approval_date,
         max(x.approval_date) filter (where x.approval_status = 'Approved') as latest_approval_date,
         max(x.last_verified_date) as last_verified,
         count(*) filter (where x.approval_status = 'Not Verified') as not_verified
  from public.intl_drug_approvals x where x.drug_id = d.id
) a on true;
grant select on public.intl_drug_overview to authenticated;
revoke all on public.intl_drug_overview from anon;

-- ---------------------------------------------------------------- KPIs
create or replace function public.intl_summary() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'us_approved', count(*) filter (where us_status = 'Approved'),
    'eu_approved', count(*) filter (where 'Europe:Approved' = any(region_status)),
    'jp_approved', count(*) filter (where jp_status = 'Approved'),
    'multi_region', count(*) filter (where approved_regions >= 2),
    'recent', count(*) filter (where latest_approval_date >= current_date - 365),
    'oncology', count(*) filter (where is_oncology),
    'rare', count(*) filter (where is_rare),
    'orphan', count(*) filter (where is_orphan),
    'pending', count(*) filter (where pending_verification),
    'mapped_drugs', count(*) filter (where mapped_doctors > 0),
    'jp_records', (select count(*) from intl_drug_approvals where country = 'JP'),
    'last_imports', (select coalesce(jsonb_agg(r order by r.started_at desc), '[]') from (
        select distinct on (source) source, status, counts, started_at, finished_at from intl_import_runs
        order by source, started_at desc) r)
  ) from intl_drug_overview
$$;
grant execute on function public.intl_summary() to authenticated;

create or replace function public.intl_reports() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'by_country', (select coalesce(jsonb_agg(x order by x.approved desc), '[]') from (
        select country, count(*) filter (where approval_status = 'Approved') approved,
               count(*) filter (where approval_status <> 'Approved') other,
               count(*) filter (where approval_status = 'Approved' and d.is_oncology) oncology
        from intl_drug_approvals a join intl_drugs d on d.id = a.drug_id group by country) x),
    'by_year', (select coalesce(jsonb_agg(x order by x.year), '[]') from (
        select extract(year from approval_date)::int as year,
               count(*) filter (where country = 'US') us, count(*) filter (where country = 'EU') eu,
               count(*) filter (where country = 'JP') jp, count(*) filter (where region = 'Europe' and country <> 'EU') europe_national
        from intl_drug_approvals where approval_status = 'Approved' and approval_date >= date '2000-01-01'
        group by 1) x),
    'requests_by_drug', (select coalesce(jsonb_agg(x order by x.requests desc), '[]') from (
        select coalesce(d.generic_name, r.requested_drug_name) as drug, count(*) requests
        from npp_drug_requests r left join intl_drugs d on d.id = r.drug_id group by 1 limit 50) x),
    'mapped', (select coalesce(jsonb_agg(x order by x.doctors desc), '[]') from (
        select d.id, d.generic_name, count(*) doctors from doctor_drug_mappings m join intl_drugs d on d.id = m.drug_id
        group by d.id, d.generic_name limit 50) x)
  )
$$;
grant execute on function public.intl_reports() to authenticated;

-- ---------------------------------------------------------------- import
-- Rows: [{match_key, drug_id?, kegg_drug_id?, generic_name, brand_names[], active_ingredient, combination_ingredients[],
--         therapeutic_area, sub_therapeutic_area, drug_class, atc_code, dosage_form, strength, route, manufacturer, mah,
--         indication, orphan_eu, orphan_us, orphan_jp, drug_type, is_oncology, is_rare, source_url,
--         approval: {country, region, authority, approval_status, approval_date, application_number, ma_number,
--                    approval_type, indication_approved, label_url, source_url, marketing_status, source_checked,
--                    search_terms, verification_notes}}]
create or replace function public.intl_import(p_origin text, p_rows jsonb, p_actor text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; a jsonb; did text; ex public.intl_drugs; ap public.intl_drug_approvals;
  c_new int := 0; c_upd int := 0; a_new int := 0; a_upd int := 0; a_same int := 0; a_locked int := 0; i_new int := 0;
  errs jsonb := '[]'::jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only Admin can import drug data' using errcode = '42501'; end if;
  if p_origin not in ('openFDA', 'EMA', 'CSV import', 'Manual') then raise exception 'Unknown origin %', p_origin; end if;
  perform set_config('app.intl_actor', coalesce(p_actor, (select email from auth.users where id = auth.uid()), p_origin), true);

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      did := null; ex := null;
      if r ? 'drug_id' and nullif(r->>'drug_id', '') is not null then
        select * into ex from intl_drugs where id = r->>'drug_id';
        if not found then raise exception 'Drug_ID % not found', r->>'drug_id'; end if;
      end if;
      if ex.id is null and nullif(r->>'kegg_drug_id', '') is not null then
        select * into ex from intl_drugs where kegg_drug_id = r->>'kegg_drug_id';
      end if;
      if ex.id is null then
        select * into ex from intl_drugs where match_key = r->>'match_key';
      end if;

      if ex.id is null then
        if nullif(r->>'match_key', '') is null or nullif(r->>'generic_name', '') is null then
          raise exception 'Generic name is required';
        end if;
        insert into intl_drugs (match_key, kegg_drug_id, generic_name, brand_names, active_ingredient, combination_ingredients,
          therapeutic_area, sub_therapeutic_area, drug_class, atc_code, dosage_form, strength, route, manufacturer, mah,
          indication, orphan_eu, orphan_us, orphan_jp, drug_type, is_oncology, is_rare, source_url, verification_status, created_by)
        values (r->>'match_key', nullif(r->>'kegg_drug_id', ''), r->>'generic_name',
          coalesce((select array_agg(distinct b) from jsonb_array_elements_text(coalesce(r->'brand_names', '[]')) b where b <> ''), '{}'),
          nullif(r->>'active_ingredient', ''),
          coalesce((select array_agg(b) from jsonb_array_elements_text(coalesce(r->'combination_ingredients', '[]')) b), '{}'),
          nullif(r->>'therapeutic_area', ''), nullif(r->>'sub_therapeutic_area', ''), nullif(r->>'drug_class', ''),
          nullif(r->>'atc_code', ''), nullif(r->>'dosage_form', ''), nullif(r->>'strength', ''), nullif(r->>'route', ''),
          nullif(r->>'manufacturer', ''), nullif(r->>'mah', ''), nullif(r->>'indication', ''),
          (r->>'orphan_eu')::boolean, (r->>'orphan_us')::boolean, (r->>'orphan_jp')::boolean, nullif(r->>'drug_type', ''),
          coalesce((r->>'is_oncology')::boolean, false), coalesce((r->>'is_rare')::boolean, false),
          nullif(r->>'source_url', ''), coalesce(nullif(r->>'verification_status', ''), 'Source-imported'),
          nullif(current_setting('app.intl_actor', true), ''))
        returning id into did;
        c_new := c_new + 1;
      else
        did := ex.id;
        if not ex.locked then
          update intl_drugs set
            kegg_drug_id = coalesce(kegg_drug_id, nullif(r->>'kegg_drug_id', '')),
            brand_names = (select coalesce(array_agg(distinct b order by b), '{}') from unnest(brand_names ||
                coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'brand_names', '[]')) x where x <> ''), '{}')) b),
            active_ingredient = coalesce(active_ingredient, nullif(r->>'active_ingredient', '')),
            therapeutic_area = coalesce(therapeutic_area, nullif(r->>'therapeutic_area', '')),
            sub_therapeutic_area = coalesce(sub_therapeutic_area, nullif(r->>'sub_therapeutic_area', '')),
            drug_class = coalesce(drug_class, nullif(r->>'drug_class', '')),
            atc_code = coalesce(atc_code, nullif(r->>'atc_code', '')),
            dosage_form = coalesce(dosage_form, nullif(r->>'dosage_form', '')),
            strength = coalesce(strength, nullif(r->>'strength', '')),
            route = coalesce(route, nullif(r->>'route', '')),
            manufacturer = coalesce(manufacturer, nullif(r->>'manufacturer', '')),
            mah = coalesce(mah, nullif(r->>'mah', '')),
            indication = coalesce(indication, nullif(r->>'indication', '')),
            orphan_eu = coalesce((r->>'orphan_eu')::boolean, orphan_eu),
            orphan_us = coalesce((r->>'orphan_us')::boolean, orphan_us),
            orphan_jp = coalesce((r->>'orphan_jp')::boolean, orphan_jp),
            drug_type = coalesce(drug_type, nullif(r->>'drug_type', '')),
            is_oncology = is_oncology or coalesce((r->>'is_oncology')::boolean, false),
            is_rare = is_rare or coalesce((r->>'is_rare')::boolean, false),
            source_url = coalesce(source_url, nullif(r->>'source_url', ''))
          where id = did;
          c_upd := c_upd + 1;
        end if;
      end if;

      a := r->'approval';
      if a is not null and jsonb_typeof(a) = 'object' then
        select * into ap from intl_drug_approvals where drug_id = did and country = a->>'country';
        if ap.id is not null and ap.locked then
          a_locked := a_locked + 1;
        elsif ap.id is null then
          insert into intl_drug_approvals (drug_id, country, region, authority, approval_status, approval_date, application_number,
            ma_number, approval_type, indication_approved, label_url, source_url, marketing_status, source_checked, search_terms,
            last_verified_date, verified_by, verification_notes, data_origin)
          values (did, a->>'country', a->>'region', nullif(a->>'authority', ''), a->>'approval_status',
            nullif(a->>'approval_date', '')::date, nullif(a->>'application_number', ''), nullif(a->>'ma_number', ''),
            nullif(a->>'approval_type', ''), nullif(a->>'indication_approved', ''), nullif(a->>'label_url', ''),
            nullif(a->>'source_url', ''), nullif(a->>'marketing_status', ''), nullif(a->>'source_checked', ''),
            nullif(a->>'search_terms', ''), coalesce(nullif(a->>'last_verified_date', '')::date, current_date),
            coalesce(nullif(a->>'verified_by', ''), p_origin), nullif(a->>'verification_notes', ''), p_origin);
          a_new := a_new + 1;
        else
          update intl_drug_approvals set
            region = a->>'region', authority = coalesce(nullif(a->>'authority', ''), authority),
            approval_status = a->>'approval_status', approval_date = nullif(a->>'approval_date', '')::date,
            application_number = nullif(a->>'application_number', ''), ma_number = nullif(a->>'ma_number', ''),
            approval_type = nullif(a->>'approval_type', ''), indication_approved = nullif(a->>'indication_approved', ''),
            label_url = coalesce(nullif(a->>'label_url', ''), label_url), source_url = nullif(a->>'source_url', ''),
            marketing_status = nullif(a->>'marketing_status', ''), source_checked = nullif(a->>'source_checked', ''),
            search_terms = nullif(a->>'search_terms', ''),
            last_verified_date = coalesce(nullif(a->>'last_verified_date', '')::date, current_date),
            verified_by = coalesce(nullif(a->>'verified_by', ''), p_origin),
            verification_notes = nullif(a->>'verification_notes', ''), data_origin = p_origin
          where id = ap.id;
          if ap.approval_status = a->>'approval_status' and ap.approval_date is not distinct from nullif(a->>'approval_date', '')::date
            then a_same := a_same + 1; else a_upd := a_upd + 1; end if;
        end if;
        ap := null;

        if nullif(a->>'indication_approved', '') is not null then
          insert into intl_drug_indications (drug_id, indication, therapeutic_area, disease_category, country, approval_status,
            approval_date, source_url)
          values (did, left(a->>'indication_approved', 8000), nullif(r->>'therapeutic_area', ''), nullif(r->>'sub_therapeutic_area', ''),
            a->>'country', a->>'approval_status', nullif(a->>'approval_date', '')::date, nullif(a->>'source_url', ''))
          on conflict (drug_id, country, indication_hash) do update set approval_status = excluded.approval_status,
            approval_date = excluded.approval_date, source_url = excluded.source_url;
          i_new := i_new + 1;
        end if;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('name', coalesce(r->>'generic_name', r->>'drug_id', '?'), 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('drugs_created', c_new, 'drugs_updated', c_upd, 'approvals_created', a_new,
    'approvals_changed', a_upd, 'approvals_unchanged', a_same, 'approvals_locked', a_locked, 'indications', i_new,
    'failed', jsonb_array_length(errs), 'errors', errs);
end $$;
revoke all on function public.intl_import(text, jsonb, text) from public, anon;
grant execute on function public.intl_import(text, jsonb, text) to authenticated;
