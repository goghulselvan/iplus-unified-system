-- Add a Board filter (State Board / Matriculation / CBSE / ICSE / International
-- Board -- same fixed list ProspectSchoolsPage already uses) to Address Label
-- Print's Prospect mode, on both get_prospect_labels and its count companion
-- (20260731_prospect_labels_count_fn.sql) -- kept in lockstep with each other.

DROP FUNCTION IF EXISTS public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid);
DROP FUNCTION IF EXISTS public.get_prospect_labels_count(text, text[], text, text[], boolean, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.get_prospect_labels(
  p_state text DEFAULT NULL,
  p_districts text[] DEFAULT NULL,
  p_school_location text DEFAULT NULL,
  p_urban_body_types text[] DEFAULT NULL,
  p_phone_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_only_unprinted boolean DEFAULT false,
  p_limit integer DEFAULT 5000,
  p_project_id uuid DEFAULT NULL,
  p_board text DEFAULT NULL
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

  v_max_class := project_eligible_class_max(p_project_id);

  RETURN QUERY
  SELECT ps.id, ps.ss_no, ps.school_name, ps.address, ps.district, ps.state,
         ps.pincode, ps.mobile, ps.label_printed_at
  FROM prospect_schools ps
  WHERE (v_max_class IS NULL OR ps.class_from IS NULL OR ps.class_from <= v_max_class)
    AND (p_state IS NULL OR ps.state = p_state)
    AND (p_districts IS NULL OR ps.district = ANY(p_districts))
    AND (p_school_location IS NULL OR ps.school_location = p_school_location)
    AND (p_board IS NULL OR ps.board = p_board)
    AND (
      p_urban_body_types IS NULL
      OR (
        CASE
          WHEN ps.urban_body ILIKE '%municipal corporation%' THEN 'Municipal Corporation'
          WHEN ps.urban_body ILIKE '%cantonment%' THEN 'Cantonment Board'
          WHEN ps.urban_body ILIKE '%municipality%' THEN 'Municipality'
          WHEN ps.urban_body ILIKE '%town panchayat%' THEN 'Town Panchayat'
          WHEN ps.urban_body ILIKE '%nagar panchayat%' THEN 'Town Panchayat'
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

REVOKE EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_prospect_labels_count(
  p_state text DEFAULT NULL,
  p_districts text[] DEFAULT NULL,
  p_school_location text DEFAULT NULL,
  p_urban_body_types text[] DEFAULT NULL,
  p_phone_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_only_unprinted boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL,
  p_board text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_max_class integer;
  v_count integer;
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL AND NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_max_class := project_eligible_class_max(p_project_id);

  SELECT count(*) INTO v_count
  FROM prospect_schools ps
  WHERE (v_max_class IS NULL OR ps.class_from IS NULL OR ps.class_from <= v_max_class)
    AND (p_state IS NULL OR ps.state = p_state)
    AND (p_districts IS NULL OR ps.district = ANY(p_districts))
    AND (p_school_location IS NULL OR ps.school_location = p_school_location)
    AND (p_board IS NULL OR ps.board = p_board)
    AND (
      p_urban_body_types IS NULL
      OR (
        CASE
          WHEN ps.urban_body ILIKE '%municipal corporation%' THEN 'Municipal Corporation'
          WHEN ps.urban_body ILIKE '%cantonment%' THEN 'Cantonment Board'
          WHEN ps.urban_body ILIKE '%municipality%' THEN 'Municipality'
          WHEN ps.urban_body ILIKE '%town panchayat%' THEN 'Town Panchayat'
          WHEN ps.urban_body ILIKE '%nagar panchayat%' THEN 'Town Panchayat'
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
    AND (NOT p_only_unprinted OR ps.label_printed_at IS NULL);

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_prospect_labels_count(text, text[], text, text[], boolean, text, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_labels_count(text, text[], text, text[], boolean, text, boolean, uuid, text) TO authenticated, service_role;
