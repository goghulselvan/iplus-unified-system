-- Reported 2026-08-11: Bharathi Vikas Matric (SS 13644) School Card showed
-- "Participants: 29" but School Detail > Name List showed "Students: 33" /
-- "Registrations: 33". Confirmed: 4 students were added on 08-11 AFTER the
-- school's last "Submit Student List" click (08-10 11:17), as part of the
-- reopen-for-more-students flow shipped earlier today. total_participants
-- only gets recomputed inside submit_student_list() — so it's correct right
-- after a Submit, but goes stale the moment a school adds more students
-- without re-submitting yet, which is now an expected, everyday state.
--
-- expected_amount/outstanding_balance never have this problem because
-- recompute_school_payment_state() already live-recomputes them on every
-- enrollment insert/delete via trg_enrollment_payment_recompute. Apply the
-- same pattern to total_participants instead of only refreshing it on Submit.
CREATE OR REPLACE FUNCTION public.recompute_school_payment_state(p_school_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count       integer;
  v_expected    numeric;
  v_received    numeric;
  v_outstanding numeric;
  v_status      payment_status;
BEGIN
  SELECT COUNT(pse.id) INTO v_count
  FROM portal_student_enrollments pse
  JOIN portal_registered_students prs ON prs.id = pse.student_id
  WHERE prs.school_id = p_school_id AND prs.project_id = p_project_id;
  v_count := COALESCE(v_count, 0);

  SELECT GREATEST(0, v_count::numeric * (COALESCE(spw.rate_per_entry, 150) - COALESCE(spw.concession_amount, 0)))
  INTO v_expected
  FROM school_project_workflow spw
  WHERE spw.school_id = p_school_id AND spw.project_id = p_project_id;
  v_expected := COALESCE(v_expected, 0);

  SELECT COALESCE(SUM(payment_amount), 0) INTO v_received
  FROM payment_transactions WHERE school_id = p_school_id;

  v_outstanding := GREATEST(0, v_expected - v_received);

  v_status := CASE
    WHEN v_received <= 0                        THEN 'Pending'::payment_status
    WHEN v_outstanding > 0                       THEN 'Partial'::payment_status
    WHEN v_received > v_expected                THEN 'Overpaid'::payment_status
    ELSE                                             'Received'::payment_status
  END;

  UPDATE schools
  SET expected_amount     = v_expected,
      payment_received    = v_received,
      outstanding_balance = v_outstanding,
      payment_status      = v_status,
      total_participants  = v_count,
      updated_at          = now()
  WHERE id = p_school_id;

  UPDATE school_project_workflow
  SET payment_status = v_status, total_participants = v_count, updated_at = now()
  WHERE school_id = p_school_id AND project_id = p_project_id;
END;
$function$;

-- One-time repair: recompute total_participants for every school directly
-- from live data (not just ones that have submitted), to fix Bharathi Vikas
-- and catch any other school in the same stale state.
UPDATE schools s SET total_participants = live.cnt, updated_at = now()
FROM (
  SELECT r.school_id, COUNT(*) AS cnt
  FROM portal_student_enrollments e
  JOIN portal_registered_students r ON r.id = e.student_id
  GROUP BY r.school_id
) live
WHERE s.id = live.school_id AND s.total_participants IS DISTINCT FROM live.cnt;

UPDATE school_project_workflow w SET total_participants = live.cnt, updated_at = now()
FROM (
  SELECT r.school_id, r.project_id, COUNT(*) AS cnt
  FROM portal_student_enrollments e
  JOIN portal_registered_students r ON r.id = e.student_id
  GROUP BY r.school_id, r.project_id
) live
WHERE w.school_id = live.school_id AND w.project_id = live.project_id
  AND w.total_participants IS DISTINCT FROM live.cnt;
