-- NPP Doctor CRM: categories (A / B / C / blank), category change log, sheet-sync
-- protection, doctor groups, outreach campaigns, reply inbox read state.
-- Category rules: only A, B, C or NULL (blank). Never defaulted, never inferred.

-- ---------------------------------------------------------------- categories
alter table public.doctors add column if not exists category_sheet_value text;
-- (doctors_category_check already allows only NULL / 'A' / 'B' / 'C')

create table if not exists public.doctor_category_changes (
  id                bigint generated always as identity primary key,
  doctor_id         uuid not null references public.doctors(id) on delete cascade,
  department        text not null,
  previous_category text check (previous_category is null or previous_category in ('A','B','C')),
  new_category      text check (new_category is null or new_category in ('A','B','C')),
  source            text not null check (source in ('MANUAL','DRAG_DROP','BULK','CSV_IMPORT','SHEET_IMPORT','API')),
  batch_id          uuid,
  changed_by        uuid,
  changed_by_email  text,
  created_at        timestamptz not null default now()
);
create index if not exists doctor_category_changes_doctor_idx on public.doctor_category_changes (doctor_id, created_at desc);
alter table public.doctor_category_changes enable row level security;
drop policy if exists doctor_category_changes_read on public.doctor_category_changes;
create policy doctor_category_changes_read on public.doctor_category_changes for select to authenticated
  using (app_private.can_access_department(department));
grant select on public.doctor_category_changes to authenticated;
revoke all on public.doctor_category_changes from anon;

-- Sheet sync can never wipe or silently overwrite a category set in the dashboard:
--  * a blank incoming value keeps the current category (blank-value protection);
--  * an incoming value equal to the sheet's previous value is stale -> dashboard value kept;
--  * only a value that changed in the sheet since the last sync is applied (logged SHEET_IMPORT).
-- Dashboard changes go through set_doctor_categories(), which marks the transaction.
create or replace function app_private.keep_manual_fields()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if new.manual_fields ? 'date_of_birth' and new.date_of_birth is null then
      new.date_of_birth := old.date_of_birth;
    end if;
    if new.manual_fields ? 'date_of_anniversary' and new.date_of_anniversary is null then
      new.date_of_anniversary := old.date_of_anniversary;
    end if;
    if coalesce(current_setting('app.category_source', true), '') <> 'dashboard'
       and new.category is distinct from old.category then
      if new.category is null then
        new.category := old.category;
      elsif new.category is not distinct from old.category_sheet_value then
        new.category := old.category;
      else
        insert into public.doctor_category_changes (doctor_id, department, previous_category, new_category, source)
        values (new.id, new.department, old.category, new.category, 'SHEET_IMPORT');
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    new.category_sheet_value := coalesce(new.category_sheet_value, new.category);
  end if;
  return new;
end;
$$;
drop trigger if exists doctors_keep_manual on public.doctors;
create trigger doctors_keep_manual before insert or update on public.doctors
  for each row execute function app_private.keep_manual_fields();

-- Set or clear the category of NPP doctors (one, many, or a whole filtered list).
create or replace function public.set_doctor_categories(p_ids uuid[], p_category text, p_source text default 'MANUAL')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_role text := app_private.current_app_role()::text;
  v_batch uuid := gen_random_uuid();
  v_email text;
  v_matched int;
  v_updated int;
begin
  if v_role is null or v_role not in ('ADMIN', 'NPP') then
    raise exception 'Only Admin and NPP users can change doctor categories';
  end if;
  if p_category is not null and p_category not in ('A', 'B', 'C') then
    raise exception 'Category must be A, B, C or blank';
  end if;
  if p_source not in ('MANUAL', 'DRAG_DROP', 'BULK', 'CSV_IMPORT', 'API') then
    raise exception 'Invalid update source';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('requested', 0, 'matched', 0, 'updated', 0, 'unchanged', 0, 'batch_id', null);
  end if;
  if array_length(p_ids, 1) > 5000 then
    raise exception 'Too many doctors in one update (max 5000)';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  perform set_config('app.category_source', 'dashboard', true);

  select count(*) into v_matched from public.doctors
   where id = any(p_ids) and department = 'NPP' and app_private.can_access_department(department);

  with targets as (
    select id, category as old_category from public.doctors
     where id = any(p_ids) and department = 'NPP' and app_private.can_access_department(department)
       and category is distinct from p_category
     for update
  ), upd as (
    update public.doctors d
       set category = p_category,
           manual_fields = d.manual_fields || '{"category": true}'::jsonb
      from targets t
     where d.id = t.id
    returning d.id, t.old_category
  ), log as (
    insert into public.doctor_category_changes (doctor_id, department, previous_category, new_category, source, batch_id, changed_by, changed_by_email)
    select id, 'NPP', old_category, p_category, p_source, v_batch, auth.uid(), v_email from upd
    returning 1
  )
  select count(*) into v_updated from log;

  perform set_config('app.category_source', '', true);
  return jsonb_build_object(
    'requested', array_length(p_ids, 1), 'matched', v_matched, 'updated', v_updated,
    'unchanged', v_matched - v_updated, 'not_found', array_length(p_ids, 1) - v_matched, 'batch_id', v_batch);
end;
$$;
revoke all on function public.set_doctor_categories(uuid[], text, text) from public, anon;
grant execute on function public.set_doctor_categories(uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------- groups
create table if not exists public.doctor_groups (
  id          uuid primary key default gen_random_uuid(),
  department  text not null default 'NPP' references public.departments(code),
  name        text not null check (length(trim(name)) between 1 and 120),
  description text,
  filters     jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (department, name)
);
create table if not exists public.doctor_group_members (
  group_id  uuid not null references public.doctor_groups(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  added_by  uuid default auth.uid(),
  added_at  timestamptz not null default now(),
  primary key (group_id, doctor_id)
);
create index if not exists doctor_group_members_doctor_idx on public.doctor_group_members (doctor_id);
alter table public.doctor_groups enable row level security;
alter table public.doctor_group_members enable row level security;
drop policy if exists doctor_groups_all on public.doctor_groups;
create policy doctor_groups_all on public.doctor_groups for all to authenticated
  using (app_private.can_access_department(department)) with check (app_private.can_access_department(department));
drop policy if exists doctor_group_members_all on public.doctor_group_members;
create policy doctor_group_members_all on public.doctor_group_members for all to authenticated
  using (exists (select 1 from public.doctor_groups g where g.id = group_id and app_private.can_access_department(g.department)))
  with check (
    exists (select 1 from public.doctor_groups g where g.id = group_id and app_private.can_access_department(g.department))
    and exists (select 1 from public.doctors d where d.id = doctor_id and d.department = (select department from public.doctor_groups where id = group_id)));
grant select, insert, update, delete on public.doctor_groups, public.doctor_group_members to authenticated;
revoke all on public.doctor_groups, public.doctor_group_members from anon;

create or replace view public.doctor_group_stats with (security_invoker = true) as
  select g.id, g.department, g.name, g.description, g.filters, g.created_at, g.updated_at,
         count(m.doctor_id) as members,
         count(m.doctor_id) filter (where d.email_norm is not null) as with_email,
         count(m.doctor_id) filter (where d.whatsapp_number is not null) as with_whatsapp,
         count(m.doctor_id) filter (where d.category = 'A') as cat_a,
         count(m.doctor_id) filter (where d.category = 'B') as cat_b,
         count(m.doctor_id) filter (where d.category = 'C') as cat_c,
         count(m.doctor_id) filter (where m.doctor_id is not null and d.category is null) as unassigned
    from public.doctor_groups g
    left join public.doctor_group_members m on m.group_id = g.id
    left join public.doctors d on d.id = m.doctor_id
   group by g.id;
grant select on public.doctor_group_stats to authenticated;

-- ---------------------------------------------------------------- outreach campaigns
create table if not exists public.outreach_campaigns (
  id             uuid primary key default gen_random_uuid(),
  department     text not null default 'NPP' references public.departments(code),
  name           text not null check (length(trim(name)) between 1 and 160),
  channel        text not null check (channel in ('EMAIL', 'WHATSAPP')),
  sequence       text check (sequence is null or sequence in ('1st Email','2nd Email','3rd Email','Follow-up Email','Final Follow-up','WhatsApp')),
  audience       jsonb not null default '{}'::jsonb,
  subject        text,
  body           text not null,
  whatsapp_template_id uuid references public.message_templates(id),
  status         text not null default 'DRAFT' check (status in ('DRAFT','SENDING','SENT','PARTIAL','FAILED','CANCELLED')),
  recipients     int not null default 0,
  sent_count     int not null default 0,
  failed_count   int not null default 0,
  skipped_count  int not null default 0,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create table if not exists public.outreach_messages (
  id                  bigint generated always as identity primary key,
  campaign_id         uuid not null references public.outreach_campaigns(id) on delete cascade,
  doctor_id           uuid not null references public.doctors(id) on delete cascade,
  department          text not null,
  channel             text not null check (channel in ('EMAIL', 'WHATSAPP')),
  category_at_send    text check (category_at_send is null or category_at_send in ('A','B','C')),
  recipient           text,
  status              text not null default 'QUEUED' check (status in ('QUEUED','SENT','DELIVERED','READ','FAILED','SKIPPED')),
  provider_message_id text,
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (campaign_id, doctor_id)
);
create index if not exists outreach_messages_doctor_idx on public.outreach_messages (doctor_id);
create index if not exists outreach_messages_provider_idx on public.outreach_messages (provider_message_id);
alter table public.outreach_campaigns enable row level security;
alter table public.outreach_messages enable row level security;
drop policy if exists outreach_campaigns_all on public.outreach_campaigns;
create policy outreach_campaigns_all on public.outreach_campaigns for all to authenticated
  using (app_private.can_access_department(department)) with check (app_private.can_access_department(department));
drop policy if exists outreach_messages_all on public.outreach_messages;
create policy outreach_messages_all on public.outreach_messages for all to authenticated
  using (app_private.can_access_department(department)) with check (app_private.can_access_department(department));
grant select, insert, update, delete on public.outreach_campaigns, public.outreach_messages to authenticated;
revoke all on public.outreach_campaigns, public.outreach_messages from anon;

-- category snapshot + inbox read state on the shared communication history
alter table public.communication_events add column if not exists category_at_send text;
alter table public.communication_events add column if not exists read_at timestamptz;
alter table public.communication_events add column if not exists read_by uuid;

-- Record an outreach send in the doctor's communication history (history table is write-protected).
create or replace function public.record_outreach_event(p_message_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select om.*, oc.name as campaign_name, oc.subject, oc.sequence into m
    from public.outreach_messages om join public.outreach_campaigns oc on oc.id = om.campaign_id
   where om.id = p_message_id;
  if not found or not app_private.can_access_department(m.department) then
    raise exception 'Message not found';
  end if;
  insert into public.communication_events (doctor_id, department, channel, direction, event_type, status, subject, detail,
                                           campaign, occurred_at, source, external_key, category_at_send)
  values (m.doctor_id, m.department, m.channel, 'OUTBOUND', coalesce(m.sequence, 'Outreach'),
          case m.status when 'SENT' then 'Sent' when 'FAILED' then 'Failed' when 'SKIPPED' then 'Not sent' else initcap(m.status) end,
          case when m.channel = 'EMAIL' then m.subject end, m.error, m.campaign_name, coalesce(m.sent_at, now()),
          'outreach', 'outreach:' || m.id, m.category_at_send)
  on conflict (external_key) do update set status = excluded.status, detail = excluded.detail, occurred_at = excluded.occurred_at;
end;
$$;
revoke all on function public.record_outreach_event(bigint) from public, anon;
grant execute on function public.record_outreach_event(bigint) to authenticated;

-- Inbox: mark replies read / unread
create or replace function public.mark_replies_read(p_ids bigint[], p_read boolean)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update public.communication_events
     set read_at = case when p_read then now() end, read_by = case when p_read then auth.uid() end
   where id = any(p_ids) and direction = 'INBOUND' and app_private.can_access_department(department);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_replies_read(bigint[], boolean) from public, anon;
grant execute on function public.mark_replies_read(bigint[], boolean) to authenticated;

-- ---------------------------------------------------------------- category summary (current category)
create or replace function public.npp_category_summary()
returns jsonb language sql stable set search_path to 'public' as $$
  with d as (select * from public.doctors where department = 'NPP'),
  ev as (
    select e.doctor_id, e.channel, e.direction, e.status from public.communication_events e
     where e.department = 'NPP'
  ),
  per as (
    select coalesce(d.category, 'UNASSIGNED') as cat,
           count(*) as doctors,
           count(*) filter (where d.email_norm is not null) as valid_email,
           count(*) filter (where d.whatsapp_number is not null) as with_whatsapp,
           coalesce(sum(d.emails_sent), 0) as emails_sent,
           coalesce(sum(d.whatsapp_sent), 0) as whatsapp_sent,
           count(*) filter (where d.emails_sent > 0 or d.whatsapp_sent > 0) as contacted
      from d group by 1
  ),
  rep as (
    select coalesce(d.category, 'UNASSIGNED') as cat,
           count(*) filter (where ev.channel = 'EMAIL' and ev.direction = 'INBOUND' and ev.status = 'Replied') as email_replies,
           count(*) filter (where ev.channel = 'WHATSAPP' and ev.direction = 'INBOUND' and ev.status = 'Replied') as whatsapp_replies,
           count(*) filter (where ev.direction = 'OUTBOUND' and ev.status = 'Failed') as failed,
           count(distinct ev.doctor_id) filter (where ev.direction = 'INBOUND' and ev.status = 'Replied') as replied_doctors
      from ev join d on d.id = ev.doctor_id group by 1
  )
  select coalesce(jsonb_object_agg(c.cat, jsonb_build_object(
           'doctors', coalesce(per.doctors, 0), 'valid_email', coalesce(per.valid_email, 0),
           'with_whatsapp', coalesce(per.with_whatsapp, 0), 'emails_sent', coalesce(per.emails_sent, 0),
           'whatsapp_sent', coalesce(per.whatsapp_sent, 0), 'contacted', coalesce(per.contacted, 0),
           'email_replies', coalesce(rep.email_replies, 0), 'whatsapp_replies', coalesce(rep.whatsapp_replies, 0),
           'failed', coalesce(rep.failed, 0), 'replied_doctors', coalesce(rep.replied_doctors, 0))), '{}'::jsonb)
    from (values ('A'), ('B'), ('C'), ('UNASSIGNED')) c(cat)
    left join per on per.cat = c.cat
    left join rep on rep.cat = c.cat
$$;
grant execute on function public.npp_category_summary() to authenticated;

-- Historical performance: category recorded at send time (outreach campaigns)
create or replace function public.npp_category_history(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable set search_path to 'public' as $$
  select coalesce(jsonb_agg(row_to_json(s) order by s.category_at_send nulls last, s.channel), '[]'::jsonb) from (
    select coalesce(category_at_send, 'UNASSIGNED') as category_at_send, channel,
           count(*) filter (where status in ('SENT','DELIVERED','READ')) as sent,
           count(*) filter (where status in ('DELIVERED','READ')) as delivered,
           count(*) filter (where status = 'FAILED') as failed,
           count(*) as total
      from public.outreach_messages
     where department = 'NPP'
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
     group by 1, 2
  ) s
$$;
grant execute on function public.npp_category_history(timestamptz, timestamptz) to authenticated;
