-- Follow-ups from the Vaima Vidyalaya E2E test:
-- 1. v_expected was NULL for schools with no workflow/enrollments, making every
--    status comparison NULL → CASE fell through to 'Partial' ("Partially Paid"
--    with ₹0 balance due). COALESCE to 0 → such payments read as Overpaid.
-- 2. schools.outstanding_balance was never maintained by this RPC — emails
--    showed "Balance Due ₹0" even for genuine partials. Now kept in sync.

CREATE OR REPLACE FUNCTION public.acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub             portal_payment_submissions%ROWTYPE;
  v_expected        numeric;
  v_total_paid      numeric;
  v_new_status      payment_status;
  v_school_received numeric;
  v_list_submitted  boolean;
  v_tx_id           uuid;
  v_project_id CONSTANT uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
BEGIN
  IF NOT is_crm_user() THEN
    RETURN jsonb_build_object('error', 'Unauthorized: CRM access required');
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Submission already processed');
  END IF;

  -- Mark submission acknowledged
  UPDATE portal_payment_submissions
  SET status = 'acknowledged', acknowledged_by = p_admin_user_id, acknowledged_at = now()
  WHERE id = p_submission_id;

  -- Mirror into CRM payment_transactions
  INSERT INTO payment_transactions (
    school_id, project_id, payment_date, payment_amount,
    payment_mode, transaction_reference, notes, created_by
  ) VALUES (
    v_sub.school_id, v_sub.project_id, v_sub.payment_date, v_sub.amount_paid,
    v_sub.payment_mode, v_sub.utr_reference, v_sub.notes, p_admin_user_id
  )
  RETURNING id INTO v_tx_id;

  -- Recalculate total from all payment_transactions (includes manual + portal)
  SELECT COALESCE(SUM(payment_amount), 0) INTO v_school_received
  FROM payment_transactions WHERE school_id = v_sub.school_id;

  -- Expected = live enrollment count × (rate - concession per enrollment)
  SELECT GREATEST(0,
    (SELECT COUNT(pse.id)
       FROM portal_student_enrollments pse
       JOIN portal_registered_students prs ON prs.id = pse.student_id
      WHERE prs.school_id = v_sub.school_id AND prs.project_id = v_project_id
    )::numeric * (COALESCE(spw.rate_per_entry, 150) - COALESCE(spw.concession_amount, 0))
  )
  INTO v_expected
  FROM school_project_workflow spw
  WHERE spw.school_id = v_sub.school_id AND spw.project_id = v_project_id;

  -- No workflow row / no enrollments → expected is NULL; treat as 0 so the
  -- status CASE below doesn't fall through to 'Partial' on NULL comparisons.
  v_expected := COALESCE(v_expected, 0);

  -- Determine new payment status
  v_new_status := CASE
    WHEN v_school_received <= 0                                          THEN 'Pending'::payment_status
    WHEN v_expected = 0 AND v_school_received > 0                        THEN 'Overpaid'::payment_status
    WHEN v_school_received > v_expected                                  THEN 'Overpaid'::payment_status
    WHEN v_school_received = v_expected                                  THEN 'Received'::payment_status
    ELSE                                                                      'Partial'::payment_status
  END;

  -- Check if student list has been submitted
  SELECT (list_submitted_at IS NOT NULL) INTO v_list_submitted
  FROM school_project_workflow
  WHERE school_id = v_sub.school_id AND project_id = v_project_id;

  -- Sync school_project_workflow — update payment_status and auto-confirm registration
  -- when fully paid AND list already submitted
  INSERT INTO school_project_workflow (school_id, project_id, payment_status)
  VALUES (v_sub.school_id, v_project_id, v_new_status)
  ON CONFLICT (school_id, project_id)
  DO UPDATE SET
    payment_status        = EXCLUDED.payment_status,
    registration_status   = CASE
                              WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                              THEN 'Confirmed'::registration_status
                              ELSE school_project_workflow.registration_status
                            END,
    updated_at            = now();

  -- Sync schools table (CRM + comms read from here)
  UPDATE schools
  SET payment_received     = v_school_received,
      payment_status       = v_new_status,
      expected_amount      = v_expected,
      outstanding_balance  = GREATEST(0, v_expected - v_school_received),
      registration_status  = CASE
                               WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                               THEN 'Confirmed'
                               ELSE registration_status
                             END,
      updated_at           = now()
  WHERE id = v_sub.school_id;

  -- Audit log
  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_admin_user_id, 'PORTAL_PAYMENT_ACKNOWLEDGED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'amount_paid', v_sub.amount_paid,
      'payment_mode', v_sub.payment_mode, 'new_status', v_new_status,
      'total_paid', v_school_received, 'expected', v_expected,
      'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_status', v_new_status::text,
    'total_paid', v_school_received,
    'expected', v_expected,
    'transaction_id', v_tx_id,
    'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
  );
END;
$$;
