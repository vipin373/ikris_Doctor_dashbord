-- India (CDSCO) approval status for FDA drugs.

-- CDSCO (India) approval status for FDA drugs. Source: CDSCO "List of New Drugs approved" PDFs.
create table if not exists public.cdsco_documents (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null unique,
  text text,
  pages integer,
  text_pages integer,
  sha256 text,
  error text,
  fetched_at timestamptz
);
alter table public.cdsco_documents enable row level security;
create policy cdsco_documents_read on public.cdsco_documents for select to authenticated using (app_private.current_app_role() is not null);
create policy cdsco_documents_admin on public.cdsco_documents for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin());

alter table public.fda_drugs
  add column if not exists india_status text
    check (india_status in ('APPROVED', 'NOT_FOUND', 'UNKNOWN', 'MANUAL_APPROVED', 'MANUAL_NOT_APPROVED')),
  add column if not exists india_evidence text,
  add column if not exists india_checked_at timestamptz;
create index if not exists fda_drugs_india_idx on public.fda_drugs (india_status);

create or replace function public.fda_overview()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', (select count(*) from fda_drugs where india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED')),
    'total_all', (select count(*) from fda_drugs),
    'by_department', coalesce((select jsonb_object_agg(coalesce(department, 'NEEDS_REVIEW'), n)
                                from (select department, count(*) n from fda_drugs
                                      where india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED') group by 1) s), '{}'),
    'needs_review', (select count(*) from fda_drugs where classification_status = 'NEEDS_REVIEW'
                       and india_status in ('NOT_FOUND', 'MANUAL_NOT_APPROVED')),
    'india', coalesce((select jsonb_object_agg(coalesce(india_status, 'NOT_CHECKED'), n)
                       from (select india_status, count(*) n from fda_drugs group by 1) s), '{}'),
    'cdsco_documents', (select count(*) from cdsco_documents where text is not null),
    'cdsco_checked_at', (select max(india_checked_at) from fda_drugs),
    'last_sync', (select to_jsonb(r) - 'cursor' from fda_sync_runs r order by started_at desc limit 1),
    'last_success', (select max(finished_at) from fda_sync_runs where status in ('SUCCESS', 'PARTIAL'))
  )
$$;

create table if not exists public.cdsco_terms (
  term text not null,
  doc_id bigint not null references public.cdsco_documents (id) on delete cascade,
  primary key (term, doc_id)
);
alter table public.cdsco_terms enable row level security;
create policy cdsco_terms_read on public.cdsco_terms for select to authenticated using (app_private.current_app_role() is not null);
create policy cdsco_terms_admin on public.cdsco_terms for all to authenticated using (app_private.is_admin()) with check (app_private.is_admin());

alter table public.fda_drugs
  add column if not exists india_keys text[],
  add column if not exists india_key_problem text;

-- Ingredient names to look up in the CDSCO lists (computed by the backend from the FDA record).
create or replace function public.fda_set_india_keys(p_token text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (app_private.is_admin() or app_private.valid_token('automation', p_token)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update fda_drugs f set
    india_keys = coalesce(array(select jsonb_array_elements_text(r->'keys')), '{}'),
    india_key_problem = nullif(r->>'problem', '')
  from jsonb_array_elements(p_rows) r
  where f.application_number = r->>'application_number';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fda_set_india_keys(text, jsonb) from public;
grant execute on function public.fda_set_india_keys(text, jsonb) to anon, authenticated;

-- Marks every FDA drug APPROVED / NOT_FOUND / UNKNOWN against the CDSCO word index.
-- Manual decisions (MANUAL_*) are never changed.
create or replace function public.fda_match_india(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (app_private.is_admin() or app_private.valid_token('automation', p_token)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from cdsco_terms) then
    return jsonb_build_object('skipped', 'No CDSCO lists loaded yet');
  end if;
  with d as (
    select id, india_keys, india_key_problem from fda_drugs
    where india_status is null or india_status not like 'MANUAL%'
  ),
  nk as (
    select d.id, k.name,
      (select bool_and(exists (select 1 from cdsco_terms t where t.term = w))
         from unnest(string_to_array(k.name, ' ')) w where w <> '') as ok,
      (select c.title from cdsco_terms t join cdsco_documents c on c.id = t.doc_id
        where t.term = (select w from unnest(string_to_array(k.name, ' ')) w order by length(w) desc limit 1)
        order by c.id limit 1) as title
    from d, unnest(d.india_keys) as k(name)
  ),
  agg as (
    select id, bool_and(ok) as all_ok, bool_or(ok) as any_ok,
      string_agg(case when ok then name || ' in “' || coalesce(title, 'CDSCO list') || '”' end, '; ') as found,
      string_agg(case when not ok then name end, ', ') as missing
    from nk group by id
  ),
  x as (
    select d.id,
      case when d.india_key_problem is not null or a.id is null then 'UNKNOWN'
           when a.all_ok then 'APPROVED'
           when a.any_ok then 'UNKNOWN'
           else 'NOT_FOUND' end as status,
      case when d.india_key_problem is not null then d.india_key_problem
           when a.id is null then 'No active ingredient name to check'
           when a.all_ok then 'Listed by CDSCO: ' || a.found
           when a.any_ok then 'Only part of the combination is in the CDSCO lists (' || a.found || '; not found: ' || a.missing || ')'
           else 'Not found in the CDSCO lists of new drugs approved in India: ' || a.missing end as evidence
    from d left join agg a on a.id = d.id
  ),
  upd as (
    update fda_drugs f set india_status = x.status, india_evidence = x.evidence, india_checked_at = now()
    from x where f.id = x.id
    returning x.status
  )
  select jsonb_object_agg(status, n) into result from (select status, count(*) n from upd group by 1) s;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.fda_match_india(text) from public;
grant execute on function public.fda_match_india(text) to anon, authenticated;
