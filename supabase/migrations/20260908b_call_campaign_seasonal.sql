-- Make the call campaign season-aware so it can be re-run every year without a
-- developer: scope every row to an olympiad_project, derive the cutoff from that
-- project's registration_deadline, and make the target pool parameters arguments
-- rather than literals baked into the function body.

alter table public.call_campaign_assignments
  add column if not exists project_id uuid references public.olympiad_projects(id) on delete cascade;
alter table public.call_campaign_log
  add column if not exists project_id uuid references public.olympiad_projects(id) on delete cascade;

update public.call_campaign_assignments
   set project_id = (select id from public.olympiad_projects where is_active order by project_year desc limit 1)
 where project_id is null;

-- A school may be worked once per season, not once ever.
alter table public.call_campaign_assignments
  drop constraint if exists call_campaign_assignments_school_uniq;
create unique index if not exists call_campaign_assignments_season_uniq
  on public.call_campaign_assignments(project_id, prospect_school_id);
create index if not exists idx_cca_project on public.call_campaign_assignments(project_id, assigned_to);

-- Cutoff defaults to 10 days before the season's registration deadline: a school
-- signed later than that cannot collect parent money and pay in time.
create or replace function public.call_campaign_cutoff(p_project_id uuid)
returns date language sql stable set search_path = public as $$
  select coalesce((registration_deadline at time zone 'Asia/Kolkata')::date - 10,
                  (now() at time zone 'Asia/Kolkata')::date + 1)
  from olympiad_projects where id = p_project_id
$$;

create or replace function public.active_olympiad_project()
returns uuid language sql stable set search_path = public as $$
  select id from olympiad_projects where is_active order by project_year desc limit 1
$$;

-- Pool criteria are now arguments. Defaults reproduce the 2026 Tamil Nadu run.
create or replace function public.assign_call_campaign(
  p_staff uuid[],
  p_per_staff int default 500,
  p_project_id uuid default null,
  p_state text default 'tamil%',
  p_require_kit boolean default true,
  p_reassign boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inserted int := 0; v_n int := array_length(p_staff,1); v_proj uuid;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  if v_n is null or v_n = 0 then raise exception 'no staff supplied'; end if;
  v_proj := coalesce(p_project_id, public.active_olympiad_project());
  if v_proj is null then raise exception 'no active olympiad project'; end if;

  if p_reassign then
    delete from call_campaign_assignments
     where project_id = v_proj and status = 'pending';
  end if;

  with pool as (
    select ps.id, ps.district,
           row_number() over (order by ps.district nulls last, ps.school_name) - 1 rn
    from prospect_schools ps
    where ps.state ilike p_state
      and coalesce(ps.is_active,true)
      and (not p_require_kit or ps.label_printed_at is not null)
      and not coalesce(ps.linked_to_crm,false)
      and coalesce(ps.whatsapp_opted_out,false) = false
      and length(regexp_replace(coalesce(nullif(ps.whatsapp,''),ps.mobile),'[^0-9]','','g')) = 10
      and not exists (select 1 from call_campaign_assignments a
                       where a.prospect_school_id = ps.id and a.project_id = v_proj)
    limit p_per_staff * v_n
  ), ins as (
    insert into call_campaign_assignments (prospect_school_id, assigned_to, district, project_id)
    select p.id, p_staff[(p.rn % v_n) + 1], p.district, v_proj from pool p
    on conflict (project_id, prospect_school_id) do nothing
    returning 1
  ) select count(*) into v_inserted from ins;

  return jsonb_build_object('assigned', v_inserted, 'staff', v_n,
                            'project_id', v_proj, 'cutoff', public.call_campaign_cutoff(v_proj));
end $$;

create or replace function public.get_my_call_campaign(p_close_date date default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid := auth.uid(); v_proj uuid; v_close date;
        v_total int; v_done int; v_today int; v_days int; v_goal int;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  v_proj  := public.active_olympiad_project();
  v_close := coalesce(p_close_date, public.call_campaign_cutoff(v_proj));

  select count(*), count(*) filter (where status <> 'pending') into v_total, v_done
  from call_campaign_assignments where assigned_to = v_uid and project_id = v_proj;

  select count(*) into v_today from call_campaign_log
   where called_by = v_uid and called_at >= date_trunc('day', now() at time zone 'Asia/Kolkata');

  v_days := greatest(1, (v_close - (now() at time zone 'Asia/Kolkata')::date));
  v_goal := greatest(20, ceil((v_total - v_done)::numeric / v_days)::int);

  return jsonb_build_object(
    'total', v_total, 'worked', v_done, 'remaining', v_total - v_done,
    'today_calls', v_today, 'today_goal', v_goal, 'days_left', v_days,
    'cutoff', v_close,
    'signed',     (select count(*) from call_campaign_assignments where assigned_to=v_uid and project_id=v_proj and status='signed'),
    'interested', (select count(*) from call_campaign_assignments where assigned_to=v_uid and project_id=v_proj and status='interested'),
    'regs_committed', (select coalesce(sum(registrations_committed),0) from call_campaign_assignments where assigned_to=v_uid and project_id=v_proj),
    'callbacks_due', (select count(*) from call_campaign_assignments
                       where assigned_to=v_uid and project_id=v_proj and callback_at is not null
                         and callback_at <= (now() at time zone 'Asia/Kolkata')::date));
end $$;

create or replace function public.log_campaign_call(
  p_assignment_id uuid, p_outcome text, p_reached_dm text default null,
  p_notes text default null, p_registrations int default 0, p_callback_at date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_proj uuid;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  select prospect_school_id, project_id into v_school, v_proj
    from call_campaign_assignments where id = p_assignment_id;
  if v_school is null then raise exception 'assignment not found'; end if;

  insert into call_campaign_log (assignment_id, prospect_school_id, project_id, called_by,
                                 outcome, reached_dm, notes, registrations_committed, callback_at)
  values (p_assignment_id, v_school, v_proj, auth.uid(), p_outcome,
          p_reached_dm, p_notes, coalesce(p_registrations,0), p_callback_at);

  update call_campaign_assignments
     set status = p_outcome, attempts = attempts + 1, last_called_at = now(),
         callback_at = case when p_outcome = 'callback' then p_callback_at else null end,
         registrations_committed = greatest(registrations_committed, coalesce(p_registrations,0)),
         notes = coalesce(p_notes, notes), updated_at = now()
   where id = p_assignment_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.assign_call_campaign(uuid[],int,uuid,text,boolean,boolean) to authenticated;
grant execute on function public.call_campaign_cutoff(uuid)  to authenticated;
grant execute on function public.active_olympiad_project()   to authenticated;
