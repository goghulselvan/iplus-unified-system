-- Fast combined name search across CRM schools + prospect schools, for the
-- Incoming Calls "link this caller" dialog. Both tables' SELECT RLS calls
-- is_crm_user() per row (slow at prospect_schools' 55k+ rows) — SECDEF here
-- bypasses that, same pattern as get_prospect_schools (S18 perf fix).
create or replace function public.search_callers_by_name(p_query text, p_limit int default 6)
returns table (
  source text,
  id uuid,
  school_name text,
  district text,
  state text
)
language sql
stable
security definer
set search_path = public
as $$
  (
    select 'crm', s.id, s.school_name, s.district, s.state
    from schools s
    where s.school_name ilike '%' || p_query || '%'
    order by s.school_name
    limit p_limit
  )
  union all
  (
    select 'prospect', p.id, p.school_name, p.district, p.state
    from prospect_schools p
    where p.school_name ilike '%' || p_query || '%'
    order by p.school_name
    limit p_limit
  )
$$;

revoke execute on function public.search_callers_by_name(text, int) from public, anon;
grant execute on function public.search_callers_by_name(text, int) to authenticated, service_role;
