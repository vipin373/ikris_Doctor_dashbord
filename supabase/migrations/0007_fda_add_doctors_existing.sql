-- fda_add_doctors: rows may reference an existing doctor (doctor_id) matched in a
-- bulk upload; then only Must See / contact frequency are applied (never a duplicate).
create or replace function public.fda_add_doctors(p_rows jsonb)
returns table (idx integer, doctor_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  i integer := 0;
  v_id uuid;
  v_dept text;
  v_new boolean;
  v_days integer;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_days := case r->>'contact_frequency' when 'WEEKLY' then 7 when '15_DAYS' then 15 when 'MONTHLY' then 30
                   when 'CUSTOM' then nullif(r->>'frequency_days', '')::int else null end;
    v_id := null;
    if r ? 'doctor_id' then
      select d.id, d.department into v_id, v_dept from doctors d where d.id = (r->>'doctor_id')::uuid;
      if v_id is null or not app_private.can_access_department(v_dept) then
        raise exception 'You cannot update this doctor' using errcode = '42501';
      end if;
      v_new := false;
    else
      if not app_private.can_access_department(r->>'department') then
        raise exception 'You cannot add doctors to %', r->>'department' using errcode = '42501';
      end if;
      select d.id into v_id from doctors d where d.department = r->>'department' and d.dedupe_key = r->>'dedupe_key';
      v_new := v_id is null;
    end if;
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
        frequency_days = case when nullif(r->>'contact_frequency', '') is null then frequency_days else v_days end,
        next_eligible_at = case
          when nullif(r->>'contact_frequency', '') is null then next_eligible_at
          when last_message_sent_at is null or v_days is null then null
          else last_message_sent_at + make_interval(days => v_days) end
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
