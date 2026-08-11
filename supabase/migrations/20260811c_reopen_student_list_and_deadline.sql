-- 1) Registration deadline becomes a per-project field instead of hardcoded.
--    Also fixes a live inconsistency: submit_student_list() was hardcoded to
--    '2026-08-21' while every portal UI screen told schools '30 Aug 2026'.
ALTER TABLE public.olympiad_projects
  ADD COLUMN IF NOT EXISTS registration_deadline timestamptz;

UPDATE public.olympiad_projects
SET registration_deadline = '2026-08-30 23:59:59+05:30'::timestamptz
WHERE is_active = true AND registration_deadline IS NULL;

-- 2) trg_enrollment_payment_recompute() had the same cascade-delete race as
-- sync_registration_counts() (fixed earlier today): it looked up school_id
-- via a join to portal_registered_students on OLD.student_id, which is
-- already gone by the time this fires on a cascaded delete. That means
-- expected_amount/outstanding_balance silently stopped recalculating after
-- a student deletion. Use the denormalized school_id/project_id columns
-- added earlier today instead.
CREATE OR REPLACE FUNCTION public.trg_enrollment_payment_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_school_id  uuid := COALESCE(NEW.school_id, OLD.school_id);
  v_project_id uuid := COALESCE(NEW.project_id, OLD.project_id);
BEGIN
  IF v_school_id IS NOT NULL THEN
    PERFORM recompute_school_payment_state(v_school_id, v_project_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- 3) Rewrite submit_student_list() for the "reopen" flow: schools can now
-- keep adding students after their first submission — earlier rounds stay
-- frozen (enforced in the portal UI by comparing each student's created_at
-- to the school's list_submitted_at), and a later "Submit" call reports just
-- the NEW batch since the last submission, not the whole cumulative list.
--
-- Also fixes two real bugs found while doing this:
--   a) total_participants was set to v_count (this call's delta only), which
--      OVERWRITES the true total on every call instead of accumulating it —
--      confirmed live: every school that has ever clicked Submit currently
--      shows total_participants = 0 despite having real enrollments.
--   b) v_count (and therefore the returned fee) was computed from `WHERE
--      submitted_at IS NULL`, but portal_student_enrollments.submitted_at is
--      stamped immediately at insert time (it drives registration-number
--      assignment, not "has this been through an official Submit"), so that
--      WHERE clause matches ~nothing for enrollments added through the
--      normal portal flow — the returned count/fee has been silently wrong
--      (usually 0) for every real submission. The actual money the school
--      owes was never affected by this (recompute_school_payment_state()
--      already live-counts every enrollment regardless of submitted_at),
--      but the confirmation message and total_participants were wrong.
CREATE OR REPLACE FUNCTION public.submit_student_list(p_school_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deadline timestamptz;
  v_prev_submitted_at timestamptz;
  v_new_count int;
  v_total_count int;
  v_fee   numeric;
  v_rate  numeric := 150;
BEGIN
  SELECT registration_deadline INTO v_deadline
  FROM olympiad_projects WHERE id = p_project_id;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RETURN jsonb_build_object('error', 'Registration deadline has passed');
  END IF;

  IF p_school_id != get_portal_school_id() AND NOT is_superadmin() THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT list_submitted_at INTO v_prev_submitted_at
  FROM school_project_workflow
  WHERE school_id = p_school_id AND project_id = p_project_id;

  -- Backfill any legacy NULL submitted_at (pre-dates the eager insert-time
  -- stamp) so the registration-number trigger still picks them up. Not used
  -- for counting below anymore.
  UPDATE portal_student_enrollments e
  SET submitted_at = now()
  FROM portal_registered_students s
  WHERE e.student_id = s.id
    AND s.school_id  = p_school_id
    AND s.project_id = p_project_id
    AND e.submitted_at IS NULL;

  -- New-this-round count: enrollments belonging to students created after
  -- the previous submission (or everyone, on a school's first submission).
  SELECT COUNT(*) INTO v_new_count
  FROM portal_student_enrollments e
  JOIN portal_registered_students s ON s.id = e.student_id
  WHERE s.school_id = p_school_id
    AND s.project_id = p_project_id
    AND (v_prev_submitted_at IS NULL OR s.created_at > v_prev_submitted_at);

  -- True cumulative total, live-counted (not accumulated/overwritten).
  SELECT COUNT(*) INTO v_total_count
  FROM portal_student_enrollments e
  JOIN portal_registered_students s ON s.id = e.student_id
  WHERE s.school_id = p_school_id AND s.project_id = p_project_id;

  SELECT COALESCE(rate_per_entry, 150) INTO v_rate
  FROM school_project_workflow
  WHERE school_id = p_school_id AND project_id = p_project_id;
  -- SELECT INTO sets the target to NULL when zero rows match (no workflow
  -- row yet) — the COALESCE above only helps once a row exists.
  v_rate := COALESCE(v_rate, 150);

  v_fee := v_new_count * v_rate;

  UPDATE schools SET
    total_participants = v_total_count,
    name_list_status    = 'Uploaded'
  WHERE id = p_school_id;

  INSERT INTO school_project_workflow (school_id, project_id, rate_per_entry, concession_amount, payment_status, list_submitted_at, name_list_status, total_participants)
  VALUES (p_school_id, p_project_id, v_rate, 0, 'Pending', now(), 'Uploaded', v_total_count)
  ON CONFLICT (school_id, project_id) DO UPDATE
  SET list_submitted_at  = now(),
      name_list_status   = 'Uploaded',
      total_participants = v_total_count;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    auth.uid(),
    'PORTAL_STUDENT_LIST_SUBMITTED',
    'school_project_workflow',
    NULL,
    jsonb_build_object(
      'school_id', p_school_id,
      'project_id', p_project_id,
      'new_this_round', v_new_count,
      'total_participants', v_total_count,
      'fee_this_round', v_fee
    )
  );

  RETURN jsonb_build_object('success', true, 'submitted', v_new_count, 'total', v_total_count, 'fee', v_fee, 'rate', v_rate);
END;
$function$;

-- One-time repair: recompute total_participants for every school that has
-- already submitted at least once, since it's been silently 0 for all of
-- them.
UPDATE schools s SET total_participants = live.cnt
FROM (
  SELECT r.school_id, COUNT(*) AS cnt
  FROM portal_student_enrollments e
  JOIN portal_registered_students r ON r.id = e.student_id
  GROUP BY r.school_id
) live
JOIN school_project_workflow w ON w.school_id = live.school_id
WHERE s.id = live.school_id AND w.list_submitted_at IS NOT NULL;
