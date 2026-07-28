-- search_callers_by_name (Call Center "Link this caller" dialog) crashes on some
-- non-numeric name searches: `p_query ~ '^\d+$' AND s.ss_no = p_query::integer`
-- relies on OR/AND short-circuit evaluation order, which Postgres does not
-- guarantee for boolean operators — the planner can evaluate p_query::integer
-- even when the regex guard is false, throwing "invalid input syntax for type
-- integer" on names like a real one that surfaced this: "XYZ Nonexistent
-- School Name". Fix: compare ss_no as text instead, which can never throw.

CREATE OR REPLACE FUNCTION public.search_callers_by_name(p_query text, p_limit int DEFAULT 6)
RETURNS TABLE (
  source text,
  id uuid,
  school_name text,
  ss_no integer,
  district text,
  state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT 'crm', s.id, s.school_name, s.ss_no, s.district, s.state
    FROM schools s
    WHERE s.school_name ILIKE '%' || p_query || '%'
       OR s.ss_no::text = p_query
    ORDER BY (s.ss_no::text = p_query) DESC, s.school_name
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'prospect', p.id, p.school_name, p.ss_no, p.district, p.state
    FROM prospect_schools p
    WHERE p.school_name ILIKE '%' || p_query || '%'
       OR p.ss_no::text = p_query
    ORDER BY (p.ss_no::text = p_query) DESC, p.school_name
    LIMIT p_limit
  )
$$;

REVOKE EXECUTE ON FUNCTION public.search_callers_by_name(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_callers_by_name(text, int) TO authenticated, service_role;
