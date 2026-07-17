-- Balance model: there is no "final payment" — status is always derived from
-- the CURRENT balance (balance due > 0 → Partial; 0 with money in → Received/
-- Overpaid). Schools can add students after paying (late registrations before
-- the exam): expected fee grows, balance due reappears, status flips back to
-- Partial automatically. This recompute runs on every enrollment change.

CREATE OR REPLACE FUNCTION public.recompute_school_payment_state(p_school_id uuid, p_project_id uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expected    numeric;
  v_received    numeric;
  v_outstanding numeric;
  v_status      payment_status;
BEGIN
  SELECT COALESCE(GREATEST(0,
    (SELECT COUNT(pse.id)
       FROM portal_student_enrollments pse
       JOIN portal_registered_students prs ON prs.id = pse.student_id
      WHERE prs.school_id = p_school_id AND prs.project_id = p_project_id
    )::numeric * (COALESCE(spw.rate_per_entry, 150) - COALESCE(spw.concession_amount, 0))
  ), 0)
  INTO v_expected
  FROM school_project_workflow spw
  WHERE spw.school_id = p_school_id AND spw.project_id = p_project_id;
  v_expected := COALESCE(v_expected, 0);

  SELECT COALESCE(SUM(payment_amount), 0) INTO v_received
  FROM payment_transactions WHERE school_id = p_school_id;

  v_outstanding := GREATEST(0, v_expected - v_received);

  v_status := CASE
    WHEN v_received <= 0                        THEN 'Pending'::payment_status
    WHEN v_outstanding > 0                      THEN 'Partial'::payment_status
    WHEN v_received > v_expected                THEN 'Overpaid'::payment_status
    ELSE                                             'Received'::payment_status
  END;

  UPDATE schools
  SET expected_amount     = v_expected,
      payment_received    = v_received,
      outstanding_balance = v_outstanding,
      payment_status      = v_status,
      updated_at          = now()
  WHERE id = p_school_id;

  UPDATE school_project_workflow
  SET payment_status = v_status, updated_at = now()
  WHERE school_id = p_school_id AND project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_enrollment_payment_recompute()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_school_id  uuid;
  v_project_id uuid;
BEGIN
  SELECT school_id, project_id INTO v_school_id, v_project_id
  FROM portal_registered_students
  WHERE id = COALESCE(NEW.student_id, OLD.student_id);

  IF v_school_id IS NOT NULL THEN
    PERFORM recompute_school_payment_state(v_school_id, v_project_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollment_balance_recompute ON public.portal_student_enrollments;
CREATE TRIGGER trg_enrollment_balance_recompute
  AFTER INSERT OR DELETE ON public.portal_student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.trg_enrollment_payment_recompute();
