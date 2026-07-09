-- Auto-link orphaned incoming calls the moment a matching phone number is
-- saved anywhere (school or prospect), instead of requiring a manual search
-- on the Incoming Calls page for every lead staff already handled elsewhere.
-- Manual search/link stays available as a fallback (link_incoming_number).

create or replace function public.attach_orphaned_inbound_calls(
  p_last10 text,
  p_school_id uuid default null,
  p_prospect_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked integer := 0;
  v_call record;
begin
  if p_last10 !~ '^[6-9]\d{9}$' or (p_school_id is null and p_prospect_id is null) then
    return 0;
  end if;

  update bonvoice_call_logs
  set school_id = coalesce(school_id, p_school_id),
      prospect_school_id = coalesce(prospect_school_id, p_prospect_id)
  where right(regexp_replace(coalesce(school_phone, ''), '\D', '', 'g'), 10) = p_last10
    and school_id is null and prospect_school_id is null;
  get diagnostics v_linked = row_count;

  -- Backfill communication history (with recording) for completed calls
  -- newly attached to a CRM school
  if p_school_id is not null and v_linked > 0 then
    for v_call in
      select call_id, direction, call_duration, resource_url
      from bonvoice_call_logs
      where school_id = p_school_id
        and right(regexp_replace(coalesce(school_phone, ''), '\D', '', 'g'), 10) = p_last10
        and status = 'completed'
        and not exists (
          select 1 from communications c where c.bonvoice_call_id = bonvoice_call_logs.call_id)
    loop
      insert into communications (
        school_id, project_id, communication_type, direction, message,
        contacted_mobile_no, duration_seconds, recording_url, bonvoice_call_id, user_id
      ) values (
        p_school_id,
        coalesce(
          (select current_project_id from schools where id = p_school_id),
          (select id from olympiad_projects where is_active = true limit 1)
        ), 'Phone',
        coalesce(v_call.direction, 'inbound'),
        format('%s call %s — answered, %sm %ss (linked retroactively)',
          initcap(coalesce(v_call.direction, 'inbound')), p_last10,
          coalesce(v_call.call_duration, 0) / 60, coalesce(v_call.call_duration, 0) % 60),
        p_last10, v_call.call_duration, v_call.resource_url, v_call.call_id,
        '8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc' -- iPlus Super Admin's profiles.user_id (FK target, not profiles.id)
      );
    end loop;
  end if;

  return v_linked;
end;
$$;

revoke execute on function public.attach_orphaned_inbound_calls(text, uuid, uuid) from public, anon;
grant execute on function public.attach_orphaned_inbound_calls(text, uuid, uuid) to authenticated, service_role;

-- Reuse the shared function from the manual-link RPC too (was duplicating this logic)
create or replace function public.link_incoming_number(
  p_last10 text,
  p_school_id uuid default null,
  p_prospect_id uuid default null,
  p_contact_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_logs integer := 0;
begin
  if p_last10 !~ '^[6-9]\d{9}$' then
    return jsonb_build_object('error', 'invalid number');
  end if;

  if p_school_id is not null then
    update schools set mobile2 = p_last10
    where id = p_school_id and (mobile2 is null or mobile2 = '');
    if not found then
      update schools
      set additional_contacts = coalesce(additional_contacts, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'name', coalesce(p_contact_name, 'Incoming caller'),
             'mobile', p_last10, 'role', ''))
      where id = p_school_id
        and right(regexp_replace(coalesce(mobile1, ''), '\D', '', 'g'), 10) <> p_last10
        and not exists (
          select 1 from jsonb_array_elements(coalesce(additional_contacts, '[]'::jsonb)) c
          where right(regexp_replace(coalesce(c->>'mobile', ''), '\D', '', 'g'), 10) = p_last10);
    end if;
    v_logs := attach_orphaned_inbound_calls(p_last10, p_school_id, null);

  elsif p_prospect_id is not null then
    update prospect_schools set mobile = p_last10
    where id = p_prospect_id and (mobile is null or mobile = '');
    if not found then
      update prospect_schools
      set additional_contacts = coalesce(additional_contacts, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'name', coalesce(p_contact_name, 'Incoming caller'),
             'mobile', p_last10, 'role', ''))
      where id = p_prospect_id
        and jsonb_array_length(coalesce(additional_contacts, '[]'::jsonb)) < 5
        and right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) <> p_last10
        and not exists (
          select 1 from jsonb_array_elements(coalesce(additional_contacts, '[]'::jsonb)) c
          where right(regexp_replace(coalesce(c->>'mobile', ''), '\D', '', 'g'), 10) = p_last10);
    end if;
    v_logs := attach_orphaned_inbound_calls(p_last10, null, p_prospect_id);
  end if;

  return jsonb_build_object('logs_linked', v_logs);
end;
$$;

-- ── Auto-retrolink triggers: fire whenever staff save a phone number through
-- their normal school/prospect workflows (add lead, edit, mark interested…) ──

create or replace function public.trg_fn_retrolink_school_calls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num text;
  v_contact jsonb;
begin
  if NEW.mobile1 is distinct from OLD.mobile1 or TG_OP = 'INSERT' then
    v_num := right(regexp_replace(coalesce(NEW.mobile1, ''), '\D', '', 'g'), 10);
    if v_num ~ '^[6-9]\d{9}$' then perform attach_orphaned_inbound_calls(v_num, NEW.id, null); end if;
  end if;
  if NEW.mobile2 is distinct from OLD.mobile2 or TG_OP = 'INSERT' then
    v_num := right(regexp_replace(coalesce(NEW.mobile2, ''), '\D', '', 'g'), 10);
    if v_num ~ '^[6-9]\d{9}$' then perform attach_orphaned_inbound_calls(v_num, NEW.id, null); end if;
  end if;
  if NEW.additional_contacts is distinct from OLD.additional_contacts or TG_OP = 'INSERT' then
    for v_contact in select jsonb_array_elements(coalesce(NEW.additional_contacts, '[]'::jsonb))
    loop
      v_num := right(regexp_replace(coalesce(v_contact->>'mobile', ''), '\D', '', 'g'), 10);
      if v_num ~ '^[6-9]\d{9}$' then perform attach_orphaned_inbound_calls(v_num, NEW.id, null); end if;
    end loop;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_retrolink_school_calls on public.schools;
create trigger trg_retrolink_school_calls
  after insert or update on public.schools
  for each row execute function public.trg_fn_retrolink_school_calls();

create or replace function public.trg_fn_retrolink_prospect_calls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num text;
  v_contact jsonb;
begin
  if NEW.mobile is distinct from OLD.mobile or TG_OP = 'INSERT' then
    v_num := right(regexp_replace(coalesce(NEW.mobile, ''), '\D', '', 'g'), 10);
    if v_num ~ '^[6-9]\d{9}$' then perform attach_orphaned_inbound_calls(v_num, null, NEW.id); end if;
  end if;
  if NEW.additional_contacts is distinct from OLD.additional_contacts or TG_OP = 'INSERT' then
    for v_contact in select jsonb_array_elements(coalesce(NEW.additional_contacts, '[]'::jsonb))
    loop
      v_num := right(regexp_replace(coalesce(v_contact->>'mobile', ''), '\D', '', 'g'), 10);
      if v_num ~ '^[6-9]\d{9}$' then perform attach_orphaned_inbound_calls(v_num, null, NEW.id); end if;
    end loop;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_retrolink_prospect_calls on public.prospect_schools;
create trigger trg_retrolink_prospect_calls
  after insert or update on public.prospect_schools
  for each row execute function public.trg_fn_retrolink_prospect_calls();
