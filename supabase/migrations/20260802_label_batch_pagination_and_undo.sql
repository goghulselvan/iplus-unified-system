-- Two changes to support custom-size batch printing (no 1000 cap) and
-- recovering from a print job that got physically interrupted (e.g. printer
-- ran out of paper mid-batch, but the app had already marked the whole batch
-- "printed" the instant the print dialog opened -- there's no way for the
-- browser to know how many labels actually came off the printer).

-- 1. Add pagination (p_offset) to get_prospect_labels so the frontend can
--    loop past PostgREST's per-request row cap to assemble an arbitrary
--    custom batch size (e.g. 1954 in one go) instead of being stuck at 1000.
DROP FUNCTION IF EXISTS public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid, text);

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
  p_board text DEFAULT NULL,
  p_offset integer DEFAULT 0
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
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_labels(text, text[], text, text[], boolean, text, boolean, integer, uuid, text, integer) TO authenticated, service_role;

-- 2. Undo the tail end of the most recently printed batch for a state.
--    mark_prospect_labels_printed stamps every row in one call with the same
--    now() value (single statement), so "the batch just printed" is exactly
--    the set of rows sharing the max label_printed_at for that state. Within
--    that set, the highest ss_no rows were the last pages in the PDF (pages
--    are built in ss_no ascending order) -- i.e. the ones most likely to be
--    the tail that never physically came out when a print job was interrupted.
CREATE OR REPLACE FUNCTION public.unmark_last_prospect_labels_printed(
  p_state text,
  p_count integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_last_ts timestamptz;
  n integer;
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL AND NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT max(label_printed_at) INTO v_last_ts
  FROM prospect_schools
  WHERE state = p_state AND label_printed_at IS NOT NULL;

  IF v_last_ts IS NULL THEN
    RETURN 0;
  END IF;

  WITH tail AS (
    SELECT id FROM prospect_schools
    WHERE state = p_state AND label_printed_at = v_last_ts
    ORDER BY ss_no DESC
    LIMIT p_count
  )
  UPDATE prospect_schools SET label_printed_at = NULL
  WHERE id IN (SELECT id FROM tail);
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unmark_last_prospect_labels_printed(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_last_prospect_labels_printed(text, integer) TO authenticated, service_role;
