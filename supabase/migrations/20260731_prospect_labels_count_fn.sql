-- Address Label Print's "Batch Print" progress panel called get_prospect_labels
-- via supabase-js .rpc(..., { count: 'exact', head: true }), which turns into an
-- HTTP HEAD request. That combination silently fails for this function (likely
-- the text[] p_districts arg not surviving GET/HEAD query-string encoding) and
-- the calling code never checked totalRes.error/remainingRes.error, so a failed
-- request silently fell back to `?? 0` on both sides -- showing "0 printed · 0
-- remaining · 0 total" and a false "All labels printed" for any state/district
-- combination that should have real, unprinted rows.
--
-- Fix: a dedicated count function called via normal POST .rpc(), same as every
-- other RPC call on this page already does successfully. WHERE clause is kept
-- in lockstep with get_prospect_labels (20260727_prospect_label_filters.sql).

CREATE OR REPLACE FUNCTION public.get_prospect_labels_count(
  p_state text DEFAULT NULL,
  p_districts text[] DEFAULT NULL,
  p_school_location text DEFAULT NULL,
  p_urban_body_types text[] DEFAULT NULL,
  p_phone_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_only_unprinted boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL
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

REVOKE EXECUTE ON FUNCTION public.get_prospect_labels_count(text, text[], text, text[], boolean, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospect_labels_count(text, text[], text, text[], boolean, text, boolean, uuid) TO authenticated, service_role;
