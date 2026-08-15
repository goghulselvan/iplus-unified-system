-- Payment verification: staff records what they actually verified in the payment
-- proof screenshot, separate from (and no longer blindly trusting) the declared
-- amount. See docs/superpowers/specs/2026-08-15-payment-verification-mismatch-design.md.

ALTER TABLE public.portal_payment_submissions ADD COLUMN IF NOT EXISTS verified_amount numeric;
ALTER TABLE public.product_orders ADD COLUMN IF NOT EXISTS verified_amount numeric;

-- acknowledge_portal_payment: now requires the verified amount, and mirrors THAT
-- (not the raw declared amount_paid) into payment_transactions, which is what
-- actually drives total_paid / payment_status downstream.
CREATE OR REPLACE FUNCTION public.acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid, p_verified_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF p_verified_amount IS NULL OR p_verified_amount < 0 THEN
    RETURN jsonb_build_object('error', 'A valid verified amount is required');
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Submission already processed');
  END IF;

  UPDATE portal_payment_submissions
  SET status = 'acknowledged', acknowledged_by = p_admin_user_id, acknowledged_at = now(),
      verified_amount = p_verified_amount
  WHERE id = p_submission_id;

  INSERT INTO payment_transactions (
    school_id, project_id, payment_date, payment_amount,
    payment_mode, transaction_reference, notes, created_by
  ) VALUES (
    v_sub.school_id, v_sub.project_id, v_sub.payment_date, p_verified_amount,
    v_sub.payment_mode, v_sub.utr_reference, v_sub.notes, p_admin_user_id
  )
  RETURNING id INTO v_tx_id;

  SELECT COALESCE(SUM(payment_amount), 0) INTO v_school_received
  FROM payment_transactions WHERE school_id = v_sub.school_id;

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

  v_expected := COALESCE(v_expected, 0);

  v_new_status := CASE
    WHEN v_school_received <= 0                                          THEN 'Pending'::payment_status
    WHEN v_expected = 0 AND v_school_received > 0                        THEN 'Overpaid'::payment_status
    WHEN v_school_received > v_expected                                  THEN 'Overpaid'::payment_status
    WHEN v_school_received = v_expected                                  THEN 'Received'::payment_status
    ELSE                                                                      'Partial'::payment_status
  END;

  SELECT (list_submitted_at IS NOT NULL) INTO v_list_submitted
  FROM school_project_workflow
  WHERE school_id = v_sub.school_id AND project_id = v_project_id;

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

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_admin_user_id, 'PORTAL_PAYMENT_ACKNOWLEDGED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'declared_amount', v_sub.amount_paid,
      'verified_amount', p_verified_amount, 'amount_mismatch', (p_verified_amount <> v_sub.amount_paid),
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
$function$;

-- confirm_product_order_payment: now requires the verified amount, stored on the order.
CREATE OR REPLACE FUNCTION public.confirm_product_order_payment(p_order_id uuid, p_verified_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_verified_amount IS NULL OR p_verified_amount < 0 THEN
    RAISE EXCEPTION 'A valid verified amount is required';
  END IF;

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Order already confirmed';
  END IF;

  UPDATE product_orders
  SET payment_status = 'confirmed',
      confirmed_at = now(),
      verified_amount = p_verified_amount,
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now(),
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$function$;

-- update_order_payment_details: new. Lets staff edit a still-pending order's
-- payment fields in place (e.g. a second transfer's proof arrives) without a
-- reject/resubmit cycle. Appends a timestamped note rather than replacing it,
-- since confirm_product_order_payment clears payment_review_note anyway once
-- the order is actually confirmed — this note is scratch space for the pending window.
CREATE OR REPLACE FUNCTION public.update_order_payment_details(
  p_order_id uuid,
  p_payment_amount numeric,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text,
  p_note text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_existing_note text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_payment_amount IS NULL OR p_payment_amount < 0 THEN
    RAISE EXCEPTION 'A valid payment amount is required';
  END IF;

  SELECT payment_status, payment_review_note INTO v_status, v_existing_note
  FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Can only update payment details while the order is pending review';
  END IF;

  UPDATE product_orders
  SET payment_amount = p_payment_amount,
      payment_mode = p_payment_mode,
      payment_date = p_payment_date,
      payment_utr_reference = p_payment_utr_reference,
      payment_account_holder_name = p_payment_account_holder_name,
      payment_screenshot_url = p_payment_screenshot_url,
      payment_review_note = CASE
        WHEN p_note IS NULL OR trim(p_note) = '' THEN v_existing_note
        WHEN v_existing_note IS NULL OR trim(v_existing_note) = '' THEN to_char(now(), 'DD Mon HH24:MI') || ': ' || trim(p_note)
        ELSE v_existing_note || E'\n' || to_char(now(), 'DD Mon HH24:MI') || ': ' || trim(p_note)
      END
  WHERE id = p_order_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_order_payment_details(uuid, numeric, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_payment_details(uuid, numeric, text, date, text, text, text, text) TO authenticated, service_role;
