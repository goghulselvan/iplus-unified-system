-- Scoreboard also reports which districts each caller owns, so a manager (who has
-- no list of their own) can see the split without opening the database.
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
                       and l.called_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')),
      'districts', (select coalesce(jsonb_agg(jsonb_build_object('name', d.district, 'n', d.n)
                                              order by d.n desc), '[]'::jsonb)
                    from (select a2.district, count(*) n
                          from call_campaign_assignments a2
                          where a2.assigned_to = a.assigned_to and a2.project_id = a.project_id
                            and a2.district is not null
                          group by a2.district) d)
    ) r
    from call_campaign_assignments a
    left join profiles  p on p.user_id = a.assigned_to
    left join auth.users u on u.id     = a.assigned_to
    group by a.assigned_to, a.project_id, p.full_name, p.email, u.email) x), '[]'::jsonb);
end $$;
