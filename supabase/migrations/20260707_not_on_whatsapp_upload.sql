-- Bulk-flag prospect numbers that are not on WhatsApp (from AskEVA result uploads).
-- Flagged schools are excluded by populate_wa_campaign_audience; their still-pending
-- rows in existing campaigns are failed out so they are never sent.
-- Replaces an earlier unused version that returned integer and matched exact digits only.
drop function if exists public.mark_not_on_whatsapp(text[]);

create function public.mark_not_on_whatsapp(p_numbers text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flagged integer;
  v_skipped integer;
begin
  with nums as (
    select distinct right(regexp_replace(x, '\D', '', 'g'), 10) as num
    from unnest(p_numbers) x
    where right(regexp_replace(x, '\D', '', 'g'), 10) ~ '^[6-9]\d{9}$'
  ),
  upd as (
    update prospect_schools ps
    set not_on_whatsapp = true
    from nums t
    where right(regexp_replace(coalesce(ps.mobile, ''), '\D', '', 'g'), 10) = t.num
      and not coalesce(ps.not_on_whatsapp, false)
    returning ps.id
  )
  select count(*) into v_flagged from upd;

  update campaign_schools cs
  set status = 'failed', error_message = 'Not on WhatsApp (excluded)'
  from prospect_schools ps
  where cs.prospect_school_id = ps.id
    and ps.not_on_whatsapp
    and cs.status = 'pending';
  get diagnostics v_skipped = row_count;

  return jsonb_build_object('flagged', v_flagged, 'pending_skipped', v_skipped);
end;
$$;

revoke execute on function public.mark_not_on_whatsapp(text[]) from public, anon;
grant execute on function public.mark_not_on_whatsapp(text[]) to authenticated, service_role;

-- Live count for the UI
create or replace function public.count_not_on_whatsapp()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from prospect_schools where not_on_whatsapp;
$$;

revoke execute on function public.count_not_on_whatsapp() from public, anon;
grant execute on function public.count_not_on_whatsapp() to authenticated, service_role;
