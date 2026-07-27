-- Address Label Print (prospect mode) needs to reproduce "main city only" targeting
-- (e.g. Municipal Corporation core of Hyderabad/Nellore/Chittoor) without an ad-hoc
-- SQL query every time. The existing page only filters state/district/search via
-- direct table selects, which can't express school_location, urban_body category,
-- or a "has valid mobile" check (mobile is stored in inconsistent raw formats, so
-- that needs regexp_replace, not a plain postgrest filter).
--
-- Scoped to this page only (not the shared get_prospect_schools RPC used by
-- ProspectSchoolsPage/campaign targeting) to avoid touching other callers.

-- Signature changes (arg type/order) create a second overload rather than replace
-- the original — drop every prior signature first so PostgREST can't end up
-- ambiguous between candidates for the same named-arg call.
DROP FUNCTION IF EXISTS public.get_prospect_labels(text, text[], text, text, boolean, text, boolean, integer);
DROP FUNCTION IF EXISTS public.get_prospect_labels(text, text[], text, text, boolean, text, boolean, integer, uuid);

CREATE OR REPLACE FUNCTION public.get_prospect_labels(
  p_state text DEFAULT NULL,
  p_districts text[] DEFAULT NULL,
  p_school_location text DEFAULT NULL,
  p_urban_body_types text[] DEFAULT NULL,
  p_phone_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_only_unprinted boolean DEFAULT false,
  p_limit integer DEFAULT 5000,
  p_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  ss_no integer,
  school_name text,
  address text,
  district text,
  state text,
  pincode text,
  mobile text,
  label_printed_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_max_class integer;
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL AND NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Exclude schools we structurally can't serve (e.g. Junior Colleges, class_from
  -- 11-12, when the active project only covers up to Class 8). Always-on, not a
  -- toggle — there's no scenario where printing labels for ineligible schools helps.
  v_max_class := project_eligible_class_max(p_project_id);

  RETURN QUERY
  SELECT ps.id, ps.ss_no, ps.school_name, ps.address, ps.district, ps.state,
         ps.pincode, ps.mobile, ps.label_printed_at
  FROM prospect_schools ps
  WHERE (v_max_class IS NULL OR ps.class_from IS NULL OR ps.class_from <= v_max_class)
    AND (p_state IS NULL OR ps.state = p_state)
    AND (p_districts IS NULL OR ps.district = ANY(p_districts))
    AND (p_school_location IS NULL OR ps.school_location = p_school_location)
    AND (
      p_urban_body_types IS NULL
      OR (
        CASE
          WHEN ps.urban_body ILIKE '%municipal corporation%' THEN 'Municipal Corporation'
          WHEN ps.urban_body ILIKE '%cantonment%' THEN 'Cantonment Board'
          WHEN ps.urban_body ILIKE '%municipality%' THEN 'Municipality'
          WHEN ps.urban_body ILIKE '%town panchayat%' THEN 'Town Panchayat'
          WHEN ps.urban_body ILIKE '%nagar panchayat%' THEN 'Town Panchayat'
          -- Tamil Nadu stores urban_body as a bare place name (no "...Corporation"
          -- suffix) for every urban body type, so its ~20 real Municipal
          -- Corporations need an explicit name match rather than a text pattern.
          WHEN ps.state = 'Tamil Nadu' AND ps.urban_body = ANY(ARRAY[
            'Chennai', 'Greater Chennai Corporation', 'Coimbatore', 'Madurai',
            'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Erode',
            'Vellore', 'Thoothukudi', 'Dindigul', 'Thanjavur', 'Nagercoil',
            'Avadi', 'Tambaram', 'Hosur'
          ]) THEN 'Municipal Corporation'
          ELSE 'Other'
        END
      ) = ANY(p_urban_body_types)
    )
    AND (
      NOT p_phone_only
      OR right(regexp_replace(COALESCE(ps.mobile, ''), '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$'
    )
    AND (p_search IS NULL OR p_search = '' OR ps.school_name ILIKE '%' || p_search || '%')
    AND (NOT p_only_unprinted OR ps.label_printed_at IS NULL)
  ORDER BY ps.ss_no
  LIMIT p_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid) TO authenticated, service_role;
