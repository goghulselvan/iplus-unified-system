-- Mirror of unmark_last_prospect_labels_printed, but for the opposite end.
-- Some label/roll printers print in reverse page order (output stacks
-- face-up in correct reading order), so a job interrupted by running out
-- of paper can leave the LOWEST ss_no (first PDF pages) unprinted while the
-- HIGHEST ss_no (printed first, in reverse) succeeded -- the opposite of
-- the naive "ran out near the end" assumption. Confirmed for the 2026-07-31
-- Telangana/Hyderabad/Urban batch (1954 schools): all sampled physically-
-- printed SS numbers landed in the top half by ss_no, none in the bottom.
CREATE OR REPLACE FUNCTION public.unmark_first_prospect_labels_printed(
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

  WITH head AS (
    SELECT id FROM prospect_schools
    WHERE state = p_state AND label_printed_at = v_last_ts
    ORDER BY ss_no ASC
    LIMIT p_count
  )
  UPDATE prospect_schools SET label_printed_at = NULL
  WHERE id IN (SELECT id FROM head);
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unmark_first_prospect_labels_printed(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmark_first_prospect_labels_printed(text, integer) TO authenticated, service_role;
