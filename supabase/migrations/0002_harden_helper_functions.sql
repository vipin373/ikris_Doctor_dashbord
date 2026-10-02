-- Move RLS helper and trigger functions out of the exposed API schema.
create schema if not exists app_private;
grant usage on schema app_private to authenticated, service_role;

alter function public.current_app_role() set schema app_private;
alter function public.is_admin() set schema app_private;
alter function public.can_access_department(text) set schema app_private;
alter function public.refresh_doctor_contact(uuid) set schema app_private;
alter function public.handle_new_user() set schema app_private;
alter function public.communication_events_after_change() set schema app_private;
alter function public.touch_updated_at() set schema app_private;

create or replace function app_private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_private.current_app_role() = 'ADMIN', false)
$$;

create or replace function app_private.can_access_department(dept text)
returns boolean language sql stable security definer set search_path = public as $$
  select case app_private.current_app_role()
    when 'ADMIN' then true
    when 'NPP' then dept = 'NPP'
    when 'RARE_DISEASES' then dept = 'RARE_DISEASES'
    else false
  end
$$;

create or replace function app_private.communication_events_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app_private.refresh_doctor_contact(coalesce(new.doctor_id, old.doctor_id));
  return null;
end;
$$;

revoke all on all functions in schema app_private from public, anon;
grant execute on function app_private.current_app_role() to authenticated;
grant execute on function app_private.is_admin() to authenticated;
grant execute on function app_private.can_access_department(text) to authenticated;

create policy bootstrap_admins_none on public.bootstrap_admins for select to authenticated using (false);

-- First administrator(s). Add more emails here before they sign in.
insert into public.bootstrap_admins (email) values ('bharat@ikrispharmanetwork.com');
