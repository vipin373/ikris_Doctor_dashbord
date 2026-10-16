-- Dashboard: add top_states next to top_cities (the Rare Diseases sheet has State but no City).
create or replace function public.dashboard_summary_locations()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'top_states', coalesce((
      select jsonb_agg(jsonb_build_object('state', state, 'count', n) order by n desc)
      from (select initcap(trim(state)) state, count(*) n from doctors
            where nullif(trim(state), '') is not null group by 1 order by 2 desc limit 8) s
    ), '[]'::jsonb)
  )
$$;
grant execute on function public.dashboard_summary_locations() to authenticated;
