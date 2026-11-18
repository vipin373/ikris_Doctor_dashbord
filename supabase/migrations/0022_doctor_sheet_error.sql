-- Rare Diseases sheet "Error" column (e.g. "Email Valid" / "Invalid") shown on the dashboard.
-- Unrecognised sheet columns are already kept in doctors.extra, so this is a generated column
-- that always mirrors the sheet value after each sync.
alter table public.doctors add column if not exists sheet_error text
  generated always as (nullif(trim(coalesce(extra->>'Error', extra->>'ERROR', extra->>'error', extra->>'Errors')), '')) stored;
create index if not exists doctors_sheet_error_idx on public.doctors (department, sheet_error);

-- Filter options: Error values per department.
do $$ declare d text; begin
  d := pg_get_functiondef('public.doctor_facets'::regproc);
  if position('sheet_errors' in d) = 0 then
    d := replace(d, '''contact_statuses'',', '''sheet_errors'', coalesce((select jsonb_agg(jsonb_build_object(''department'', department, ''value'', v, ''count'', n) order by department, v)
                      from (select department, sheet_error v, count(*) n from doctors where sheet_error is not null group by 1, 2) s), ''[]''::jsonb),
    ''contact_statuses'',');
    execute d;
  end if;
end $$;
