-- Project-scoped school delete: removing a school from the Schools page must
-- only remove it from the given project. Past-project history is preserved.
-- The schools row itself is deleted only when no other project references it
-- (typical "wrong school added as interested" case), restoring the prospect
-- to the uncontacted pool either way.

CREATE OR REPLACE FUNCTION public.delete_school_from_project(p_school_id uuid, p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining int;
  v_prospect uuid;
BEGIN
  -- Authenticated callers must be CRM staff; service-role/SQL callers have no JWT.
  IF current_setting('request.jwt.claims', true) IS NOT NULL
     AND NOT public.is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT prospect_school_id INTO v_prospect FROM schools WHERE id = p_school_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Remove this project's data only
  DELETE FROM school_project_workflow WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM student_registrations   WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM follow_ups              WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM exam_slots              WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM exam_schedules          WHERE school_id = p_school_id AND project_id = p_project_id;

  SELECT count(*) INTO v_remaining
  FROM school_project_workflow WHERE school_id = p_school_id;

  IF v_remaining = 0 THEN
    -- No history in any other project — remove the school entirely.
    -- FK guards (portal registration, results, payment proofs) still apply.
    DELETE FROM schools WHERE id = p_school_id;
    IF v_prospect IS NOT NULL THEN
      UPDATE prospect_schools SET stage = 'uncontacted', linked_to_crm = false
      WHERE id = v_prospect;
    END IF;
    RETURN 'deleted_school';
  ELSE
    -- Past projects exist — keep the school, clear current-project state.
    UPDATE schools SET
      current_project_id = CASE WHEN current_project_id = p_project_id THEN NULL ELSE current_project_id END,
      registration_status = 'Pending',
      registration_interest = NULL,
      contacted = 'No'
    WHERE id = p_school_id;
    IF v_prospect IS NOT NULL THEN
      UPDATE prospect_schools SET stage = 'uncontacted' WHERE id = v_prospect;
    END IF;
    RETURN 'removed_from_project';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_school_from_project(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_school_from_project(uuid, uuid) TO authenticated, service_role;
