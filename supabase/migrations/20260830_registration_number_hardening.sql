-- ============================================================================
-- Registration-number hardening — 2026-08-30
-- Root cause (see analysis): assign_registration_number() took two
-- transaction-length blocking advisory locks. Under the authenticator role's
-- lock_timeout=8s, bulk portal adds during peak load hit lock_not_available
-- (55P03), which trg_auto_assign_reg_number()'s `EXCEPTION WHEN OTHERS`
-- swallowed as a WARNING with no retry -> 481 enrolments (13% on peak days)
-- silently left with registration_number = NULL.
--
-- This migration:
--   1. ensure_school_code()   — remove txn-length advisory lock; make race-safe
--                               via the EXISTING unique constraints
--                               (school_codes_project_state_district_code_key,
--                                school_codes_school_id_project_id_key) + bounded
--                               retry-on-conflict; mark SECURITY DEFINER.
--   2. assign_registration_number() — drop the now-redundant roll-number advisory
--                               lock (student_registration_sequences upsert is
--                               already atomic via its unique key); add an
--                               explicit non-numeric class_code guard.
--   3. portal_student_enrollments — UNIQUE (project_id, registration_number) so a
--                               duplicate number can never silently persist.
--   4. registration_number_health — snapshot table fed by a monitoring cron.
--   5. cron `reg-number-auto-retry`   — every 5 min, sweep any NULL-number
--                               enrolment on an active project through
--                               retry_registration_numbers() (runs as postgres:
--                               no lock_timeout -> waits instead of failing).
--   6. cron `reg-number-health-log`   — every 5 min (offset), snapshot the
--                               backlog into registration_number_health.
--
-- Deferred to a post-deadline migration (documented in the plan):
--   * async queue + worker (assignment fully off the insert path)
--   * selective re-raise in the trigger (fail-loud on non-recoverable codes)
--   * strict entry-order roll numbers
--   * wider fixed-width format for 2027+
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ensure_school_code: lock-free, race-safe, SECURITY DEFINER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_school_code(p_school_id uuid, p_project_id uuid)
 RETURNS TABLE(state_code text, district_code text, school_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state    text;
  v_district text;
  v_next     int;
  v_code     text;
  v_attempt  int := 0;
BEGIN
  -- Fast path: already assigned for this project
  RETURN QUERY
    SELECT sc.state_code, sc.district_code, sc.school_code
    FROM school_codes sc
    WHERE sc.school_id = p_school_id AND sc.project_id = p_project_id;
  IF FOUND THEN RETURN; END IF;

  -- Resolve district -> (state_code, district_code) from the reference table
  SELECT dc.state_code, dc.district_code
    INTO v_state, v_district
  FROM schools s
  JOIN district_codes dc
    ON LOWER(TRIM(dc.district_name)) = LOWER(TRIM(s.district))
   AND dc.is_active = true
  WHERE s.id = p_school_id
  LIMIT 1;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'ensure_school_code: no district_codes entry for school % (district="%")',
      p_school_id, (SELECT district FROM schools WHERE id = p_school_id);
  END IF;

  -- Race-safe first-come-first-served allocation.
  -- No advisory lock: rely on the two existing UNIQUE constraints on school_codes
  -- (school_id,project_id) and (project_id,state_code,district_code,school_code)
  -- and retry on unique_violation. Bounded so a genuine wedge fails loudly.
  LOOP
    v_attempt := v_attempt + 1;

    -- Another txn may have just created the row for this school
    RETURN QUERY
      SELECT sc.state_code, sc.district_code, sc.school_code
      FROM school_codes sc
      WHERE sc.school_id = p_school_id AND sc.project_id = p_project_id;
    IF FOUND THEN RETURN; END IF;

    SELECT COALESCE(MAX(sc2.school_code::int), 0) + 1
      INTO v_next
    FROM school_codes sc2
    WHERE sc2.project_id    = p_project_id
      AND sc2.state_code    = v_state
      AND sc2.district_code = v_district;

    v_code := LPAD(v_next::text, 2, '0');

    BEGIN
      INSERT INTO school_codes (school_id, project_id, state_code, district_code, school_code, is_active)
      VALUES (p_school_id, p_project_id, v_state, v_district, v_code, true);

      RETURN QUERY SELECT v_state, v_district, v_code;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Either this school now has a row (next loop's re-check returns it),
      -- or the serial we picked was taken (next loop recomputes MAX+1).
      IF v_attempt >= 25 THEN
        RAISE EXCEPTION 'ensure_school_code: could not allocate a school code for school % in %/%/% after % attempts',
          p_school_id, p_project_id, v_state, v_district, v_attempt;
      END IF;
    END;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. assign_registration_number: no advisory lock, explicit class_code guard
-- ---------------------------------------------------------------------------
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

  -- Class code must be numeric: classes 01-12, LKG=14, UKG=15.
  IF v_class_code IS NULL OR v_class_code !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'assign_registration_number: non-numeric class_code "%" on student % (enrollment %) — correct the student record',
      v_class_code, v_student_id, p_enrollment_id;
  END IF;
  v_class_int := v_class_code::int;

  -- Subject code: project-specific first, then any project
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

  -- Reuse the roll digits if this student already has a number on another subject
  SELECT e2.registration_number INTO v_reg_num
  FROM portal_student_enrollments e2
  WHERE e2.student_id = v_student_id AND e2.registration_number IS NOT NULL AND e2.id != p_enrollment_id
  LIMIT 1;

  IF v_reg_num IS NOT NULL THEN
    v_roll := SPLIT_PART(v_reg_num, '-', 6)::int;
  ELSE
    -- Atomic, race-safe roll counter. The unique key
    -- (school_id,project_id,class_code) makes ON CONFLICT DO UPDATE serialise
    -- correctly on its own — no advisory lock required.
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

-- ---------------------------------------------------------------------------
-- 3. Uniqueness backstop — a duplicate number can never silently persist
--    (registration_number is unique per enrolment: the subject code is part of
--     it, so a multi-subject student has distinct numbers per subject.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pse_project_regnum') THEN
    ALTER TABLE public.portal_student_enrollments
      ADD CONSTRAINT uq_pse_project_regnum UNIQUE (project_id, registration_number);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Monitoring snapshot table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_number_health (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  project_id       uuid,
  stuck_total      int NOT NULL,
  stuck_over_15min int NOT NULL,
  oldest_stuck_at  timestamptz,
  sample_ids       uuid[]
);
ALTER TABLE public.registration_number_health ENABLE ROW LEVEL SECURITY;
-- No policy: readable only by postgres / service_role (internal ops table).

-- ---------------------------------------------------------------------------
-- 5. Auto-retry sweeper — heals any residual failure within 5 minutes.
--    Runs as postgres (no lock_timeout role setting) so it waits for locks
--    rather than timing out. Idempotent: retry_registration_numbers() skips
--    rows that already have a number.
-- ---------------------------------------------------------------------------
SELECT cron.schedule('reg-number-auto-retry', '*/5 * * * *', $CRON$
  SET LOCAL statement_timeout = '240s';
  SELECT public.retry_registration_numbers(ARRAY(
    SELECT e.id
    FROM public.portal_student_enrollments e
    JOIN public.olympiad_projects p ON p.id = e.project_id
    WHERE p.is_active
      AND (e.registration_number IS NULL OR e.registration_number = '')
    ORDER BY e.created_at
    LIMIT 500
  ));
$CRON$);

-- ---------------------------------------------------------------------------
-- 6. Health snapshot — every 5 min, offset by 2 min so it measures *after*
--    the sweeper. Writes a heartbeat row per active project even when clean.
-- ---------------------------------------------------------------------------
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
  WHERE p.is_active
  GROUP BY p.id;
$CRON$);

COMMIT;
