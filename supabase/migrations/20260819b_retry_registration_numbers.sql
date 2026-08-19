-- Safety net for the registration-number silent-failure class of bug found and
-- fixed 2026-08-19 (see project_registration_number_system memory). The
-- underlying trigger (trg_auto_assign_reg_number) still swallows any failure as
-- an invisible Postgres warning with no retry — this doesn't change that, but
-- gives every insert call site (portal self-registration, CRM single-add,
-- CRM bulk CSV upload, class corrections) a way to immediately check "did this
-- actually work?" and retry once, right when it happens, instead of the gap
-- sitting silently for weeks until someone audits it.
--
-- Idempotent and safe to call on every batch: rows that already have a number
-- are left untouched and reported as already-succeeded; only truly-missing ones
-- attempt assign_registration_number, each in its own exception handler so one
-- bad row (e.g. an unmapped district) can't block the rest of the batch.
CREATE OR REPLACE FUNCTION public.retry_registration_numbers(p_enrollment_ids uuid[])
RETURNS TABLE(enrollment_id uuid, success boolean, registration_number text, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_existing text;
  v_result text;
BEGIN
  IF p_enrollment_ids IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_enrollment_ids LOOP
    SELECT e.registration_number INTO v_existing
    FROM portal_student_enrollments e WHERE e.id = v_id;

    IF v_existing IS NOT NULL THEN
      enrollment_id := v_id; success := true; registration_number := v_existing; error_message := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      v_result := assign_registration_number(v_id);
      enrollment_id := v_id; success := true; registration_number := v_result; error_message := NULL;
    EXCEPTION WHEN OTHERS THEN
      enrollment_id := v_id; success := false; registration_number := NULL; error_message := SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retry_registration_numbers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_registration_numbers(uuid[]) TO authenticated, service_role;
