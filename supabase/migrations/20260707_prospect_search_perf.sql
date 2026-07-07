-- Fix "canceling statement due to statement timeout" on prospect schools search.
--
-- The 12-arg get_prospect_schools was created WITHOUT SECURITY DEFINER, so the
-- prospect_schools RLS policy (is_crm_user()) ran per row — 55k profile lookups
-- per scan, twice per call (count + page) ≈ 6s+, blowing the 8s statement timeout.
-- Its siblings (get_prospect_districts, get_prospect_filter_options) and the
-- original 10-arg version were always SECURITY DEFINER.
--
-- Fix: SECURITY DEFINER + one upfront auth check (same pattern as
-- delete_school_from_project). Also drop the two stale overloads (10/11-arg)
-- that no code calls, so PostgREST can't pick the wrong one.

DROP FUNCTION IF EXISTS public.get_prospect_schools(text, text, text, text, text, boolean, boolean, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_prospect_schools(text, text, text, text, text, boolean, boolean, text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_prospect_schools(
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_district text DEFAULT NULL,
  p_board text DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_mobile boolean DEFAULT NULL,
  p_school_category text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_max_class integer DEFAULT NULL,
  p_active_only boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total bigint;
  v_rows  json;
BEGIN
  -- Auth check once, not per row: JWT callers must be CRM users; service/SQL callers pass
  IF current_setting('request.jwt.claims', true) IS NOT NULL AND NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM prospect_schools
  WHERE
    (p_search IS NULL OR school_name ILIKE '%' || p_search || '%' OR udise_code = p_search OR ss_no::text = p_search)
    AND (p_state          IS NULL OR state           = p_state)
    AND (p_district       IS NULL OR district        = p_district)
    AND (p_board          IS NULL OR board           = p_board)
    AND (p_stage          IS NULL OR stage           = p_stage)
    AND (p_school_category IS NULL OR school_category = p_school_category)
    AND (p_has_email  IS NULL OR (p_has_email  = true AND email  IS NOT NULL) OR (p_has_email  = false))
    AND (p_has_mobile IS NULL OR (p_has_mobile = true AND mobile IS NOT NULL) OR (p_has_mobile = false))
    AND (p_max_class IS NULL OR class_from IS NULL OR class_from <= p_max_class)
    AND (p_active_only IS NULL OR p_active_only = false OR COALESCE(is_active, true) = true);

  SELECT json_agg(t) INTO v_rows FROM (
    SELECT
      ps.id, ps.ss_no, ps.udise_code, ps.school_name,
      ps.district, ps.state, ps.board,
      ps.stage, ps.email, ps.mobile, ps.website,
      ps.principal_name, ps.address, ps.pincode,
      ps.school_location, ps.school_management, ps.school_type,
      ps.school_category, ps.class_from, ps.class_to,
      ps.linked_to_crm, ps.is_active,
      CASE
        WHEN ps.linked_to_crm = true AND EXISTS (
          SELECT 1 FROM schools s
          JOIN school_project_workflow spw ON spw.school_id = s.id
          WHERE s.prospect_school_id = ps.id
        ) THEN true ELSE false
      END AS has_history
    FROM prospect_schools ps
    WHERE
      (p_search IS NULL OR ps.school_name ILIKE '%' || p_search || '%' OR ps.udise_code = p_search OR ps.ss_no::text = p_search)
      AND (p_state          IS NULL OR ps.state           = p_state)
      AND (p_district       IS NULL OR ps.district        = p_district)
      AND (p_board          IS NULL OR ps.board           = p_board)
      AND (p_stage          IS NULL OR ps.stage           = p_stage)
      AND (p_school_category IS NULL OR ps.school_category = p_school_category)
      AND (p_has_email  IS NULL OR (p_has_email  = true AND ps.email  IS NOT NULL) OR (p_has_email  = false))
      AND (p_has_mobile IS NULL OR (p_has_mobile = true AND ps.mobile IS NOT NULL) OR (p_has_mobile = false))
      AND (p_max_class IS NULL OR ps.class_from IS NULL OR ps.class_from <= p_max_class)
      AND (p_active_only IS NULL OR p_active_only = false OR COALESCE(ps.is_active, true) = true)
    ORDER BY ps.ss_no
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN json_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_prospect_schools(text, text, text, text, text, boolean, boolean, text, integer, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_schools(text, text, text, text, text, boolean, boolean, text, integer, integer, integer, boolean) TO authenticated, service_role;
