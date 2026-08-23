CREATE OR REPLACE FUNCTION public.issue_credit_refund(
  p_credit_note_id uuid,
  p_amount numeric,
  p_refund_mode text,
  p_refund_reference text,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_application_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive';
  END IF;
  IF p_refund_mode IS NULL OR trim(p_refund_mode) = '' THEN
    RAISE EXCEPTION 'Refund mode is required';
  END IF;

  -- Same advisory-lock domain as Task 4's approve_order_items (hashtext of the
  -- credit note id) — serializes this refund not just against a concurrent
  -- second refund on the same note, but against a concurrent order-approval
  -- spending the same note too, closing the read-then-check-then-write race
  -- this exact bug class already needed fixing twice elsewhere in this plan.
  PERFORM pg_advisory_xact_lock(hashtext(p_credit_note_id::text));

  SELECT remaining_balance INTO v_balance
  FROM credit_notes_with_balance WHERE id = p_credit_note_id;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Refund amount (%) exceeds remaining credit balance (%)', p_amount, v_balance;
  END IF;

  INSERT INTO credit_note_applications (credit_note_id, application_type, amount, refund_mode, refund_reference, note, recorded_by)
  VALUES (p_credit_note_id, 'refund', p_amount, trim(p_refund_mode), NULLIF(trim(p_refund_reference), ''), NULLIF(trim(p_note), ''), auth.uid())
  RETURNING id INTO v_application_id;

  RETURN v_application_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_credit_refund(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_refund(uuid, numeric, text, text, text) TO authenticated, service_role;
