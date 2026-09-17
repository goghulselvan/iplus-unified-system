-- Call Campaign tracker: assign the brochure-primed TN prospect pool to staff,
-- log every attempt, and expose per-staff daily goals + a manager scoreboard.

create table if not exists public.call_campaign_assignments (
  id                     uuid primary key default gen_random_uuid(),
  prospect_school_id     uuid not null references public.prospect_schools(id) on delete cascade,
  assigned_to            uuid references auth.users(id) on delete set null,
  district               text,
  status                 text not null default 'pending',
  attempts               int  not null default 0,
  last_called_at         timestamptz,
  callback_at            date,
  registrations_committed int not null default 0,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint call_campaign_assignments_school_uniq unique (prospect_school_id),
  constraint call_campaign_assignments_status_chk check (status in
    ('pending','no_answer','gatekeeper','callback','interested','signed','not_now','refused','wrong_number'))
);

create index if not exists idx_cca_assigned  on public.call_campaign_assignments(assigned_to, status);
create index if not exists idx_cca_callback  on public.call_campaign_assignments(callback_at) where callback_at is not null;
create index if not exists idx_cca_district  on public.call_campaign_assignments(district);

create table if not exists public.call_campaign_log (
  id                      uuid primary key default gen_random_uuid(),
  assignment_id           uuid references public.call_campaign_assignments(id) on delete cascade,
  prospect_school_id      uuid,
  called_by               uuid,
  outcome                 text not null,
  reached_dm              text,
  notes                   text,
  registrations_committed int not null default 0,
  callback_at             date,
  called_at               timestamptz not null default now(),
  constraint call_campaign_log_outcome_chk check (outcome in
    ('signed','callback','not_now','refused','no_answer','wrong_number','gatekeeper','interested'))
);
create index if not exists idx_ccl_by_day on public.call_campaign_log(called_by, called_at);

alter table public.call_campaign_assignments enable row level security;
alter table public.call_campaign_log         enable row level security;

drop policy if exists cca_all on public.call_campaign_assignments;
create policy cca_all on public.call_campaign_assignments
  for all using (public.is_crm_user()) with check (public.is_crm_user());

drop policy if exists ccl_all on public.call_campaign_log;
create policy ccl_all on public.call_campaign_log
  for all using (public.is_crm_user()) with check (public.is_crm_user());

-- Round-robin the pool across staff, district by district, so each caller's list
-- clusters geographically (reference stories and travel both benefit).
create or replace function public.assign_call_campaign(p_staff uuid[], p_per_staff int default 400)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inserted int := 0; v_n int := array_length(p_staff,1);
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  if v_n is null or v_n = 0 then raise exception 'no staff supplied'; end if;

  with pool as (
    select ps.id, ps.district,
           row_number() over (order by ps.district nulls last, ps.school_name) rn
    from prospect_schools ps
    where ps.state ilike 'tamil%'
      and coalesce(ps.is_active,true)
      and ps.label_printed_at is not null
      and not coalesce(ps.linked_to_crm,false)
      and length(regexp_replace(coalesce(nullif(ps.whatsapp,''),ps.mobile),'[^0-9]','','g')) = 10
      and not exists (select 1 from call_campaign_assignments a where a.prospect_school_id = ps.id)
    limit p_per_staff * v_n
  ), ins as (
    insert into call_campaign_assignments (prospect_school_id, assigned_to, district)
    select id, p_staff[ ((rn - 1) % v_n) + 1 ], district from pool
    on conflict (prospect_school_id) do nothing
    returning 1
  ) select count(*) into v_inserted from ins;

  return jsonb_build_object('assigned', v_inserted, 'staff', v_n, 'per_staff', p_per_staff);
end $$;

-- One call's worth of bookkeeping: append to the log, roll the assignment forward.
create or replace function public.log_campaign_call(
  p_assignment_id uuid, p_outcome text, p_reached_dm text default null,
  p_notes text default null, p_registrations int default 0, p_callback_at date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  select prospect_school_id into v_school from call_campaign_assignments where id = p_assignment_id;
  if v_school is null then raise exception 'assignment not found'; end if;

  insert into call_campaign_log (assignment_id, prospect_school_id, called_by, outcome,
                                 reached_dm, notes, registrations_committed, callback_at)
  values (p_assignment_id, v_school, auth.uid(), p_outcome,
          p_reached_dm, p_notes, coalesce(p_registrations,0), p_callback_at);

  update call_campaign_assignments
     set status = p_outcome,
         attempts = attempts + 1,
         last_called_at = now(),
         callback_at = case when p_outcome = 'callback' then p_callback_at else null end,
         registrations_committed = greatest(registrations_committed, coalesce(p_registrations,0)),
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_assignment_id;

  return jsonb_build_object('ok', true, 'assignment_id', p_assignment_id, 'outcome', p_outcome);
end $$;

-- Everything one caller needs on login: today's goal, today's progress, callbacks due.
create or replace function public.get_my_call_campaign(p_close_date date default '2026-09-20')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_uid uuid := auth.uid(); v_total int; v_done int; v_today int; v_days int; v_goal int;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  select count(*) filter (where true),
         count(*) filter (where status <> 'pending')
    into v_total, v_done
  from call_campaign_assignments where assigned_to = v_uid;

  select count(*) into v_today from call_campaign_log
   where called_by = v_uid and called_at >= date_trunc('day', now() at time zone 'Asia/Kolkata');

  v_days := greatest(1, (p_close_date - (now() at time zone 'Asia/Kolkata')::date));
  v_goal := greatest(20, ceil((v_total - v_done)::numeric / v_days)::int);

  return jsonb_build_object(
    'total', v_total, 'worked', v_done, 'remaining', v_total - v_done,
    'today_calls', v_today, 'today_goal', v_goal, 'days_left', v_days,
    'signed', (select count(*) from call_campaign_assignments where assigned_to=v_uid and status='signed'),
    'interested', (select count(*) from call_campaign_assignments where assigned_to=v_uid and status='interested'),
    'regs_committed', (select coalesce(sum(registrations_committed),0) from call_campaign_assignments where assigned_to=v_uid),
    'callbacks_due', (select count(*) from call_campaign_assignments
                       where assigned_to=v_uid and callback_at is not null
                         and callback_at <= (now() at time zone 'Asia/Kolkata')::date),
    'by_district', coalesce((select jsonb_agg(d) from (
        select jsonb_build_object('district', coalesce(district,'—'),
                 'total', count(*), 'worked', count(*) filter (where status <> 'pending'),
                 'signed', count(*) filter (where status='signed')) d
        from call_campaign_assignments where assigned_to = v_uid
        group by district order by count(*) desc) x), '[]'::jsonb));
end $$;

-- Manager scoreboard.
create or replace function public.get_call_campaign_scoreboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  return coalesce((select jsonb_agg(r order by r->>'name') from (
    select jsonb_build_object(
      'user_id', a.assigned_to,
      'name', coalesce(p.full_name, p.email, u.email, 'Unassigned'),
      'total', count(*),
      'worked', count(*) filter (where a.status <> 'pending'),
      'signed', count(*) filter (where a.status = 'signed'),
      'interested', count(*) filter (where a.status = 'interested'),
      'callbacks_due', count(*) filter (where a.callback_at is not null
                        and a.callback_at <= (now() at time zone 'Asia/Kolkata')::date),
      'regs_committed', coalesce(sum(a.registrations_committed),0),
      'calls_today', (select count(*) from call_campaign_log l where l.called_by = a.assigned_to
                       and l.called_at >= date_trunc('day', now() at time zone 'Asia/Kolkata'))
    ) r
    from call_campaign_assignments a
    -- profiles.id is NOT the auth user id in this schema; profiles.user_id is.
    -- The app itself resolves the current profile with .eq('user_id', session.user.id).
    left join profiles  p on p.user_id = a.assigned_to
    left join auth.users u on u.id     = a.assigned_to
    group by a.assigned_to, p.full_name, p.email, u.email) x), '[]'::jsonb);
end $$;

grant execute on function public.assign_call_campaign(uuid[], int)        to authenticated;
grant execute on function public.log_campaign_call(uuid,text,text,text,int,date) to authenticated;
grant execute on function public.get_my_call_campaign(date)               to authenticated;
grant execute on function public.get_call_campaign_scoreboard()           to authenticated;
