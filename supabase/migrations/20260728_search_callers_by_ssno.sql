-- search_callers_by_name (Call Center "Link this caller" dialog) only matched
-- school_name — searching by SS No, the identifier used everywhere else in this
-- CRM, silently returned zero results with no indication why. Add an SS No
-- match (exact, when the query is all digits) and surface ss_no in the result
-- so staff can confirm they picked the right school among similarly-named ones.

DROP FUNCTION IF EXISTS public.search_callers_by_name(text, int);

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
       OR (p_query ~ '^\d+$' AND s.ss_no = p_query::integer)
    ORDER BY (s.ss_no::text = p_query) DESC, s.school_name
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'prospect', p.id, p.school_name, p.ss_no, p.district, p.state
    FROM prospect_schools p
    WHERE p.school_name ILIKE '%' || p_query || '%'
       OR (p_query ~ '^\d+$' AND p.ss_no = p_query::integer)
    ORDER BY (p.ss_no::text = p_query) DESC, p.school_name
    LIMIT p_limit
  )
$$;

REVOKE EXECUTE ON FUNCTION public.search_callers_by_name(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_callers_by_name(text, int) TO authenticated, service_role;
