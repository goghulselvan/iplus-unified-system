-- Receipt numbering by Indian financial year (Apr 1 – Mar 31, IST).
-- Receipt display format: {fy}-{seq}-{ss_no}, e.g. 26-1-3098 for FY 2026-27.
-- Sequence is first-come-first-serve per FY and resets each April 1.

-- Per-FY counter (atomic upsert = race-safe next number)
CREATE TABLE IF NOT EXISTS public.receipt_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
ALTER TABLE public.receipt_fy_counters ENABLE ROW LEVEL SECURITY;

-- fy on each issued receipt; numbers now unique per FY (not globally)
ALTER TABLE public.receipt_numbers ADD COLUMN IF NOT EXISTS fy smallint;
ALTER TABLE public.receipt_numbers DROP CONSTRAINT IF EXISTS receipt_numbers_receipt_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_numbers_fy_no
  ON public.receipt_numbers (fy, receipt_number);

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_ist  timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_fy   smallint;
  v_next integer;
BEGIN
  -- Indian FY: Jan–Mar belong to the previous year's FY
  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;

  INSERT INTO receipt_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO receipt_numbers (payment_transaction_id, receipt_number, fy, generated_at)
  VALUES (NEW.id, v_next, v_fy, now());

  RETURN NEW;
END;
$$;

-- The trigger itself never made it to the unified DB (it lived only on the old
-- CRM project) — recreate it here.
DROP TRIGGER IF EXISTS auto_generate_receipt_number ON public.payment_transactions;
CREATE TRIGGER auto_generate_receipt_number
  AFTER INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.generate_receipt_number();

-- Paginated transactions now return fy so the UI can show the full receipt no
-- (return type changes, so the old function must be dropped first)
DROP FUNCTION IF EXISTS public.get_payment_transactions_paginated(uuid, integer, integer);
CREATE FUNCTION public.get_payment_transactions_paginated(
  p_school_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, school_id uuid, payment_date date, payment_amount numeric,
  payment_mode text, transaction_reference text, notes text,
  created_at timestamp with time zone, receipt_number integer, receipt_fy smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pt.id, pt.school_id, pt.payment_date, pt.payment_amount, pt.payment_mode,
    pt.transaction_reference, pt.notes, pt.created_at,
    rn.receipt_number, rn.fy
  FROM payment_transactions pt
  LEFT JOIN receipt_numbers rn ON rn.payment_transaction_id = pt.id
  WHERE pt.school_id = p_school_id
  ORDER BY pt.payment_date DESC, pt.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- acknowledge_portal_payment: also return the created transaction id so the
-- client can generate + send the receipt for it
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

  -- Sync schools table (CRM reads from here)
  UPDATE schools
  SET payment_received     = v_school_received,
      payment_status       = v_new_status,
      expected_amount      = v_expected,
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

-- Private receipts bucket: staff read via signed URLs, service role writes
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crm_read_receipts" ON storage.objects;
CREATE POLICY "crm_read_receipts" ON storage.objects
  FOR SELECT USING (bucket_id = 'receipts' AND is_crm_user());
