-- WA campaign delivery analytics: funnel counts + per-school engagement list

create or replace function public.get_wa_campaign_delivery_stats(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'delivered', count(*) filter (where delivery_status = 'delivered'),
    'read',      count(*) filter (where delivery_status = 'read'),
    'replied',   count(*) filter (where delivery_status = 'replied'),
    'failed',    count(*) filter (where delivery_status in ('failed','frequency_cap'))
  )
  from campaign_schools
  where campaign_id = p_campaign_id;
$$;

revoke execute on function public.get_wa_campaign_delivery_stats(uuid) from public, anon;
grant execute on function public.get_wa_campaign_delivery_stats(uuid) to authenticated, service_role;

-- p_status: null = engaged (delivered/read/replied), 'failed' = failed + frequency_cap,
--           'all' = everything with a delivery_status, else exact match
create or replace function public.get_wa_campaign_engagement(
  p_campaign_id uuid,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  school_name text,
  district text,
  state text,
  mobile text,
  delivery_status text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  reply_text text,
  replied_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select cs.id, ps.school_name, ps.district, ps.state, ps.mobile,
         cs.delivery_status, cs.sent_at, cs.delivered_at, cs.opened_at,
         r.message_text, r.received_at
  from campaign_schools cs
  join prospect_schools ps on ps.id = cs.prospect_school_id
  left join lateral (
    select message_text, received_at
    from wa_replies
    where campaign_school_id = cs.id
    order by received_at desc
    limit 1
  ) r on true
  where cs.campaign_id = p_campaign_id
    and (
      (p_status is null       and cs.delivery_status in ('delivered','read','replied'))
      or (p_status = 'failed' and cs.delivery_status in ('failed','frequency_cap'))
      or (p_status = 'all'    and cs.delivery_status is not null)
      or cs.delivery_status = p_status
    )
  order by cs.opened_at desc nulls last, cs.delivered_at desc nulls last, cs.sent_at desc nulls last
  limit p_limit offset p_offset;
$$;

revoke execute on function public.get_wa_campaign_engagement(uuid, text, int, int) from public, anon;
grant execute on function public.get_wa_campaign_engagement(uuid, text, int, int) to authenticated, service_role;
