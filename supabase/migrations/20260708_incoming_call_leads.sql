-- Incoming call leads: link inbound Bonvoice calls to CRM schools / prospects,
-- capture unknown callers as leads, and remember linked numbers for future calls.

alter table public.bonvoice_call_logs
  add column if not exists school_id uuid references public.schools(id) on delete set null;

create index if not exists idx_bvcl_school_phone on public.bonvoice_call_logs(school_phone);
create index if not exists idx_bvcl_inbound on public.bonvoice_call_logs(direction, created_at desc);
create unique index if not exists uq_bvcl_call_id on public.bonvoice_call_logs(call_id) where call_id is not null;

-- Match a caller (last 10 digits) to a CRM school first, then a prospect school
create or replace function public.match_phone_all(p_last10 text)
returns table (school_id uuid, prospect_school_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select s.id from schools s
      where right(regexp_replace(coalesce(s.mobile1, ''), '\D', '', 'g'), 10) = p_last10
         or right(regexp_replace(coalesce(s.mobile2, ''), '\D', '', 'g'), 10) = p_last10
         or exists (
              select 1 from jsonb_array_elements(coalesce(s.additional_contacts, '[]'::jsonb)) c
              where right(regexp_replace(coalesce(c->>'mobile', ''), '\D', '', 'g'), 10) = p_last10)
      limit 1),
    (select p.id from prospect_schools p
      where right(regexp_replace(coalesce(p.mobile, ''), '\D', '', 'g'), 10) = p_last10
         or exists (
              select 1 from jsonb_array_elements(coalesce(p.additional_contacts, '[]'::jsonb)) c
              where right(regexp_replace(coalesce(c->>'mobile', ''), '\D', '', 'g'), 10) = p_last10)
      limit 1);
$$;

revoke execute on function public.match_phone_all(text) from public, anon;
grant execute on function public.match_phone_all(text) to authenticated, service_role;

-- Link an unknown caller number to a school or prospect:
-- stores the number on the record (so future calls auto-match) and backfills existing logs.
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

    update bonvoice_call_logs set school_id = p_school_id
    where right(regexp_replace(coalesce(school_phone, ''), '\D', '', 'g'), 10) = p_last10
      and school_id is null;
    get diagnostics v_logs = row_count;

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

    update bonvoice_call_logs set prospect_school_id = p_prospect_id
    where right(regexp_replace(coalesce(school_phone, ''), '\D', '', 'g'), 10) = p_last10
      and prospect_school_id is null
      and school_id is null;
    get diagnostics v_logs = row_count;
  end if;

  return jsonb_build_object('logs_linked', v_logs);
end;
$$;

revoke execute on function public.link_incoming_number(text, uuid, uuid, text) from public, anon;
grant execute on function public.link_incoming_number(text, uuid, uuid, text) to authenticated, service_role;

-- Staff need to update logs from the Incoming Calls page (linking is via RPC, but keep parity with insert policy)
create policy "crm_update_call_logs" on public.bonvoice_call_logs
  for update using (true) with check (true);
