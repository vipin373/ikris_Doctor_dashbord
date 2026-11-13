-- EMA and PMDA workspaces with the same features as FDA.
-- The FDA pipeline (drug table, classification, India/CDSCO check, KEGG, doctor
-- matching, templates, campaigns, review, sending, logs) gains a `regulator`
-- dimension instead of being copied, so every feature works identically for
-- FDA, EMA and PMDA. Existing rows are FDA.
--
-- In fda_drugs for EMA / PMDA rows:
--   application_number  EMA product number (EMEA/H/C/…) or PMDA-<date>-<no>-<key>
--   fda_status          the regulator's own status (EMA "Authorised"; PMDA "Approved" / "Approved (partial change)")
--   drugs_at_fda_url    the regulator's page for the product (EPAR page / PMDA list)
--   fda_source          source name shown in the UI and email footer

alter table public.fda_drugs add column if not exists regulator text not null default 'FDA';
alter table public.fda_drugs drop constraint if exists fda_drugs_regulator_check;
alter table public.fda_drugs add constraint fda_drugs_regulator_check check (regulator in ('FDA', 'EMA', 'PMDA'));
alter table public.fda_drugs add column if not exists orphan boolean;
create index if not exists fda_drugs_regulator_idx on public.fda_drugs (regulator, india_status);

alter table public.message_templates add column if not exists regulator text not null default 'FDA';
alter table public.message_templates drop constraint if exists message_templates_regulator_check;
alter table public.message_templates add constraint message_templates_regulator_check check (regulator in ('FDA', 'EMA', 'PMDA'));
alter table public.message_templates drop constraint if exists message_templates_template_type_check;
alter table public.message_templates add constraint message_templates_template_type_check check (template_type in
  ('FDA_DRUG_UPDATE', 'EMA_DRUG_UPDATE', 'PMDA_DRUG_UPDATE', 'NEW_DRUG', 'PRODUCT_INFORMATION', 'AVAILABILITY',
   'PATIENT_ACCESS', 'DOCTOR_FOLLOW_UP', 'GENERAL', 'CUSTOM'));

alter table public.campaigns add column if not exists regulator text not null default 'FDA';
alter table public.campaigns drop constraint if exists campaigns_regulator_check;
alter table public.campaigns add constraint campaigns_regulator_check check (regulator in ('FDA', 'EMA', 'PMDA'));

alter table public.fda_sync_runs add column if not exists regulator text not null default 'FDA';

-- Sync writer: store regulator and orphan flag (FDA rows keep defaults).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.fda_sync_write(text,jsonb,date)'::regprocedure);
  if position('regulator' in d) = 0 then
    d := replace(d, 'review_flags, record_hash, retrieved_at, last_synced_at
    ) values (', 'review_flags, record_hash, retrieved_at, last_synced_at, regulator, orphan
    ) values (');
    d := replace(d, 'coalesce(r->''review_flags'', ''[]''), r->>''record_hash'', now(), now()
    )', 'coalesce(r->''review_flags'', ''[]''), r->>''record_hash'', now(), now(),
      coalesce(r->>''regulator'', ''FDA''), (r->>''orphan'')::boolean
    )');
    d := replace(d, 'record_hash = excluded.record_hash, retrieved_at = now(), last_synced_at = now()',
                    'record_hash = excluded.record_hash, retrieved_at = now(), last_synced_at = now(),
      regulator = excluded.regulator, orphan = excluded.orphan');
    execute d;
  end if;
end $$;

create or replace function public.fda_overview(p_regulator text default 'FDA') returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'regulator', p_regulator,
    'total', (select count(*) from fda_drugs where regulator = p_regulator and india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED')),
    'total_all', (select count(*) from fda_drugs where regulator = p_regulator),
    'by_department', coalesce((select jsonb_object_agg(coalesce(department, 'NEEDS_REVIEW'), n)
                                from (select department, count(*) n from fda_drugs
                                      where regulator = p_regulator and india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED') group by 1) s), '{}'),
    'needs_review', (select count(*) from fda_drugs where regulator = p_regulator and classification_status = 'NEEDS_REVIEW'
                       and india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED')),
    'india', coalesce((select jsonb_object_agg(coalesce(india_status, 'NOT_CHECKED'), n)
                       from (select india_status, count(*) n from fda_drugs where regulator = p_regulator group by 1) s), '{}'),
    'cdsco_documents', (select count(*) from cdsco_documents where text is not null),
    'cdsco_checked_at', (select max(india_checked_at) from fda_drugs where regulator = p_regulator),
    'last_sync', (select to_jsonb(r) - 'cursor' from fda_sync_runs r where r.regulator = p_regulator order by started_at desc limit 1),
    'last_success', (select max(finished_at) from fda_sync_runs where regulator = p_regulator and status in ('SUCCESS', 'PARTIAL'))
  )
$$;
drop function if exists public.fda_overview();
grant execute on function public.fda_overview(text) to authenticated;

drop function if exists public.new_molecules(integer);
create or replace function public.new_molecules(p_days integer default 365, p_regulator text default 'FDA')
returns table(id uuid, drug_name text, active_ingredient text, manufacturer text, department text, therapeutic_areas text[],
              approval_date date, india_status text, created_at timestamptz, application_number text)
language sql stable set search_path = public as $$
  select f.id, f.drug_name, f.active_ingredient, f.manufacturer, f.department, f.therapeutic_areas,
    f.approval_date, f.india_status, f.created_at, f.application_number
  from fda_drugs f
  where f.regulator = p_regulator
    and f.approval_date >= current_date - p_days
    and cardinality(coalesce(f.india_keys, '{}')) > 0
    and not exists (
      select 1 from fda_drugs o
      where o.regulator = f.regulator and o.id <> f.id and o.india_keys = f.india_keys and o.approval_date < f.approval_date
    )
  order by f.approval_date desc, f.drug_name
$$;
grant execute on function public.new_molecules(integer, text) to authenticated;

-- FDA scheduled sync context counts FDA rows only (EMA/PMDA rows must not switch it to incremental).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.fda_sync_context(text)'::regprocedure);
  d := replace(d, '''drug_count'', (select count(*) from fda_drugs)', '''drug_count'', (select count(*) from fda_drugs where regulator = ''FDA'')');
  d := replace(d, 'from fda_sync_runs r where status in (''SUCCESS'', ''PARTIAL'')', 'from fda_sync_runs r where r.regulator = ''FDA'' and status in (''SUCCESS'', ''PARTIAL'')');
  d := replace(d, 'from fda_sync_runs r where status = ''RUNNING''', 'from fda_sync_runs r where r.regulator = ''FDA'' and status = ''RUNNING''');
  execute d;
end $$;

-- Sync runs record which regulator they belong to.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.fda_sync_run_save(text,jsonb)'::regprocedure);
  d := replace(d, 'insert into fda_sync_runs (mode, trigger, triggered_by, cursor)
    values (coalesce(p_run->>''mode'', ''FULL''), coalesce(p_run->>''trigger'', ''MANUAL''), auth.uid(), coalesce(p_run->''cursor'', ''{}''))',
  'insert into fda_sync_runs (mode, trigger, triggered_by, cursor, regulator)
    values (coalesce(p_run->>''mode'', ''FULL''), coalesce(p_run->>''trigger'', ''MANUAL''), auth.uid(), coalesce(p_run->''cursor'', ''{}''),
            coalesce(p_run->>''regulator'', ''FDA''))');
  execute d;
end $$;

-- Sent-message logs carry the regulator of their campaign (filterable without reading campaigns).
alter table public.message_logs add column if not exists regulator text not null default 'FDA';
update public.message_logs m set regulator = c.regulator from public.campaigns c where c.id = m.campaign_id and m.regulator <> c.regulator;
create or replace function app_private.message_log_regulator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.campaign_id is not null then
    new.regulator := coalesce((select regulator from campaigns where id = new.campaign_id), new.regulator, 'FDA');
  end if;
  return new;
end $$;
drop trigger if exists message_logs_regulator on public.message_logs;
create trigger message_logs_regulator before insert on public.message_logs for each row execute function app_private.message_log_regulator();
create index if not exists message_logs_regulator_idx on public.message_logs (regulator, created_at desc);
