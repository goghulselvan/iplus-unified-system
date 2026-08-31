-- ============================================================================
-- Registration number: don't hard-fail an unlinked portal school  — 2026-08-31
--
-- 20260830b made trg_auto_assign_reg_number re-raise non-recoverable errors so
-- bad data fails loudly. But a portal school that isn't linked to a CRM school
-- yet has portal_registered_students.school_id = NULL — a *supported* state
-- (students are added pre-link, then reassign_pending_portal_students() backfills
-- school_id on linking). assign_registration_number -> ensure_school_code(NULL,..)
-- raised "no district_codes entry for school <NULL>", which the trigger then
-- re-raised, blocking the school's "add student" entirely.
--
-- Fix: a NULL school_id is "not ready yet", not an error — assign_registration_
-- number returns NULL and the enrolment saves without a number. The
-- reg-number-auto-retry sweeper assigns it once the school is linked. The two
-- crons are filtered so unlinked students aren't churned every 5 min or counted
-- as "stuck" (which would spam the alert email).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_registration_number(p_enrollment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_olympiad_code text;
  v_student_id    uuid;
  v_school_id     uuid;
  v_project_id    uuid;
  v_class_code    text;
  v_class_int     int;
  v_subject_num   int;
  v_state         text;
  v_district      text;
  v_school        text;
  v_roll          int;
  v_reg_num       text;
BEGIN
  SELECT e.olympiad_code, s.id, s.school_id, s.project_id, s.class_code
  INTO v_olympiad_code, v_student_id, v_school_id, v_project_id, v_class_code
  FROM portal_student_enrollments e
  JOIN portal_registered_students s ON s.id = e.student_id
  WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment % not found', p_enrollment_id; END IF;

  -- Portal school not yet linked to a CRM school: number can't be built (no
  -- district/school code) and that's expected. Not an error — the sweeper
  -- assigns it after reassign_pending_portal_students() backfills school_id.
  IF v_school_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Class code must be numeric: classes 01-12, LKG=14, UKG=15.
  IF v_class_code IS NULL OR v_class_code !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'assign_registration_number: non-numeric class_code "%" on student % (enrollment %) — correct the student record',
      v_class_code, v_student_id, p_enrollment_id;
  END IF;
  v_class_int := v_class_code::int;

  SELECT subject_code::int INTO v_subject_num
  FROM olympiad_subjects
  WHERE alphabetical_code = v_olympiad_code AND project_id = v_project_id
  LIMIT 1;

  IF v_subject_num IS NULL THEN
    SELECT subject_code::int INTO v_subject_num
    FROM olympiad_subjects WHERE alphabetical_code = v_olympiad_code
    LIMIT 1;
  END IF;

  IF v_subject_num IS NULL THEN
    RAISE EXCEPTION 'Unknown olympiad_code: % — add it to olympiad_subjects for project %', v_olympiad_code, v_project_id;
  END IF;

  SELECT state_code, district_code, school_code
    INTO v_state, v_district, v_school
  FROM ensure_school_code(v_school_id, v_project_id);

  SELECT e2.registration_number INTO v_reg_num
  FROM portal_student_enrollments e2
  WHERE e2.student_id = v_student_id AND e2.registration_number IS NOT NULL AND e2.id != p_enrollment_id
  LIMIT 1;

  IF v_reg_num IS NOT NULL THEN
    v_roll := SPLIT_PART(v_reg_num, '-', 6)::int;
  ELSE
    INSERT INTO student_registration_sequences (school_id, project_id, class_code, last_sequence)
    VALUES (v_school_id, v_project_id, v_class_int, 1)
    ON CONFLICT (school_id, project_id, class_code)
    DO UPDATE SET last_sequence = student_registration_sequences.last_sequence + 1
    RETURNING last_sequence INTO v_roll;
  END IF;

  v_reg_num := CONCAT_WS('-',
    v_subject_num::text, v_state,
    LPAD((v_district::int)::text, 2, '0'),
    LPAD((v_school::int)::text, 2, '0'),
    LPAD(v_class_int::text, 2, '0'),
    LPAD(v_roll::text, 3, '0')
  );

  UPDATE portal_student_enrollments SET registration_number = v_reg_num WHERE id = p_enrollment_id;
  RETURN v_reg_num;
END;
$function$;

-- Sweeper: skip enrolments whose student isn't linked to a school yet
SELECT cron.schedule('reg-number-auto-retry', '*/5 * * * *', $CRON$
  SET LOCAL statement_timeout = '240s';
  SELECT public.retry_registration_numbers(ARRAY(
    SELECT e.id
    FROM public.portal_student_enrollments e
    JOIN public.olympiad_projects p ON p.id = e.project_id
    WHERE p.is_active
      AND (e.registration_number IS NULL OR e.registration_number = '')
      AND EXISTS (SELECT 1 FROM public.portal_registered_students r
                  WHERE r.id = e.student_id AND r.school_id IS NOT NULL)
    ORDER BY e.created_at
    LIMIT 500
  ));
  UPDATE public.registration_number_failures f
  SET resolved_at = now()
  WHERE f.resolved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.portal_student_enrollments e
      WHERE e.id = f.enrollment_id
        AND e.registration_number IS NOT NULL AND e.registration_number <> ''
    );
$CRON$);

-- Health log: unlinked students are not "stuck" — exclude them so the alert
-- email doesn't fire for a school that just hasn't been linked yet
SELECT cron.schedule('reg-number-health-log', '2-59/5 * * * *', $CRON$
  INSERT INTO public.registration_number_health
    (project_id, stuck_total, stuck_over_15min, oldest_stuck_at, sample_ids)
  SELECT
    p.id,
    count(e.id),
    count(e.id) FILTER (WHERE e.created_at < now() - interval '15 minutes'),
    min(e.created_at),
    (array_agg(e.id ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL))[1:25]
  FROM public.olympiad_projects p
  LEFT JOIN public.portal_student_enrollments e
    ON e.project_id = p.id
   AND (e.registration_number IS NULL OR e.registration_number = '')
   AND EXISTS (SELECT 1 FROM public.portal_registered_students r
               WHERE r.id = e.student_id AND r.school_id IS NOT NULL)
  WHERE p.is_active
  GROUP BY p.id;
$CRON$);

COMMIT;
