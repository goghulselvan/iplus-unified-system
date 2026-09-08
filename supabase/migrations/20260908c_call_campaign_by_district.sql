-- Assign WHOLE districts to a caller rather than round-robining rows.
-- Round-robin gave every caller a slice of all 34 districts, which is the
-- opposite of clustering: one caller should own Coimbatore end to end so the
-- local reference stories ("the school down the road has confirmed") work.
-- Greedy bin-pack: biggest district first, always to the least-loaded caller.

create or replace function public.assign_call_campaign(
  p_staff uuid[],
  p_per_staff int default 500,
  p_project_id uuid default null,
  p_state text default 'tamil%',
  p_require_kit boolean default true,
  p_reassign boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int := array_length(p_staff,1);
  v_proj uuid;
  v_cap int;
  v_load int[];
  v_rec record;
  v_pick int;
  v_i int;
  v_inserted int := 0;
  v_added int;
begin
  if not public.is_crm_user() then raise exception 'not authorised'; end if;
  if v_n is null or v_n = 0 then raise exception 'no staff supplied'; end if;
  v_proj := coalesce(p_project_id, public.active_olympiad_project());
  if v_proj is null then raise exception 'no active olympiad project'; end if;

  if p_reassign then
    delete from call_campaign_assignments
     where project_id = v_proj and status = 'pending'
       and not exists (select 1 from call_campaign_log l where l.assignment_id = call_campaign_assignments.id);
  end if;

  v_cap  := p_per_staff;
  v_load := array_fill(0, array[v_n]);

  -- districts, largest first
  for v_rec in
    select ps.district d, count(*) n
    from prospect_schools ps
    where ps.state ilike p_state
      and coalesce(ps.is_active,true)
      and (not p_require_kit or ps.label_printed_at is not null)
      and not coalesce(ps.linked_to_crm,false)
      and coalesce(ps.whatsapp_opted_out,false) = false
      and length(regexp_replace(coalesce(nullif(ps.whatsapp,''),ps.mobile),'[^0-9]','','g')) = 10
      and not exists (select 1 from call_campaign_assignments a
                       where a.prospect_school_id = ps.id and a.project_id = v_proj)
    group by ps.district
    order by count(*) desc, ps.district
  loop
    -- least-loaded caller that still has capacity
    v_pick := null;
    for v_i in 1..v_n loop
      if v_load[v_i] < v_cap and (v_pick is null or v_load[v_i] < v_load[v_pick]) then
        v_pick := v_i;
      end if;
    end loop;
    exit when v_pick is null;

    insert into call_campaign_assignments (prospect_school_id, assigned_to, district, project_id)
    select ps.id, p_staff[v_pick], ps.district, v_proj
    from prospect_schools ps
    where ps.district is not distinct from v_rec.d
      and ps.state ilike p_state
      and coalesce(ps.is_active,true)
      and (not p_require_kit or ps.label_printed_at is not null)
      and not coalesce(ps.linked_to_crm,false)
      and coalesce(ps.whatsapp_opted_out,false) = false
      and length(regexp_replace(coalesce(nullif(ps.whatsapp,''),ps.mobile),'[^0-9]','','g')) = 10
      and not exists (select 1 from call_campaign_assignments a
                       where a.prospect_school_id = ps.id and a.project_id = v_proj)
    on conflict (project_id, prospect_school_id) do nothing;

    get diagnostics v_added = row_count;
    v_load[v_pick] := v_load[v_pick] + v_added;
    v_inserted := v_inserted + v_added;
  end loop;

  return jsonb_build_object('assigned', v_inserted, 'staff', v_n, 'project_id', v_proj,
                            'per_caller', to_jsonb(v_load), 'mode', 'whole-district');
end $$;

grant execute on function public.assign_call_campaign(uuid[],int,uuid,text,boolean,boolean) to authenticated;
