-- 2026-10-17 — No replacement for a return that was settled with a credit note, even after it is
-- marked received (New Creation SS 7620, CN/26-27/9 showed "Send Replacement").
CREATE OR REPLACE FUNCTION public.mark_replacement_sent(p_return_id uuid, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason_category text;
  v_status text;
  v_replacement_sent_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same advisory-lock domain issue_credit_for_return / mark_return_received
  -- already use — serializes this against a concurrent second attempt.
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT reason_category, status, replacement_sent_at
  INTO v_reason_category, v_status, v_replacement_sent_at
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_reason_category != 'wrong_item_shipped' THEN
    RAISE EXCEPTION 'Replacement dispatch only applies to wrong-item-shipped returns';
  END IF;
  -- Check the credit note itself, not the status: once a credited return is marked received its
  -- status becomes 'received' and the old status check let a free replacement through (2026-10-17).
  IF v_status = 'credit_issued' OR EXISTS (SELECT 1 FROM credit_notes WHERE source_return_id = p_return_id) THEN
    RAISE EXCEPTION 'A credit was already issued for this return instead of a replacement';
  END IF;
  IF v_replacement_sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'Replacement has already been marked as sent for this return';
  END IF;

  UPDATE product_returns
  SET replacement_sent_at = now(), replacement_sent_by = auth.uid(),
      replacement_order_reference = NULLIF(trim(p_reference), '')
  WHERE id = p_return_id;
END;
$function$;
