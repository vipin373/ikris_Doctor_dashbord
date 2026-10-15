-- Let any signed-in user (Admin, NPP, Rare Diseases) run "Sync Google Sheets".
-- The sync must read and write every department's rows, so the backend sends a
-- server-only secret in the `x-sync-token` header (env SYNC_DB_TOKEN; its SHA-256
-- hash lives in app_settings.sync_token). Users' own sessions never carry it, so
-- normal department access through the app is unchanged.

create or replace function app_private.sync_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.current_app_role() is not null
     and app_private.valid_token('sync',
           coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-sync-token', ''))
$$;
revoke all on function app_private.sync_session() from public, anon;
grant execute on function app_private.sync_session() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['doctors', 'doctor_source_rows', 'communication_events', 'google_sheet_sources',
                           'google_sheet_tabs', 'google_sheet_sync_logs', 'patient_feedback', 'email_templates']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_sync_session', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (app_private.sync_session()) with check (app_private.sync_session())',
                   t || '_sync_session', t);
  end loop;
end $$;

-- The hash itself is set once, outside version control:
-- insert into app_settings (key, value) values ('sync_token', jsonb_build_object('hash', '<sha256 hex>'))
--   on conflict (key) do update set value = excluded.value;
