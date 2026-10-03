-- Let an Admin run "Sync now" with their own session (no service role key needed).
create policy doctor_source_rows_admin_write on public.doctor_source_rows for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());
create policy communication_events_admin_write on public.communication_events for all to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());
create policy sync_logs_admin_insert on public.google_sheet_sync_logs for insert to authenticated
  with check (app_private.is_admin());
create policy sync_logs_admin_update on public.google_sheet_sync_logs for update to authenticated
  using (app_private.is_admin()) with check (app_private.is_admin());
-- Any signed-in user may write audit rows about themselves only.
create policy audit_logs_self_insert on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid() and app_private.current_app_role() is not null);
