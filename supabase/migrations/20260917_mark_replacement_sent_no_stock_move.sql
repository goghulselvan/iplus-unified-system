-- Reverts the stock decrement 20260915 added. It double-counted.
--
-- A wrong-item-shipped cycle is already complete in stock without it:
--   invoice            → ordered book −qty  (never actually left the shelf)
--   report_return      → wrong book   −qty  (it did leave)
--   mark_return_received → wrong book +qty  (it came back)
-- The invoice's decrement of the ordered book is what stands in for the
-- replacement, so taking it off again when the replacement ships counts the
-- same books twice. Proven against the physical stock list on 2026-09-17:
-- Class 5 GK & Social Science, Class 5 Logical Reasoning, Class 7 and Class 8
-- Mock Test all reconcile exactly with this model.
--
-- Do not add a stock movement here again without reconciling a real product's
-- ledger end to end first.
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
  IF v_status = 'credit_issued' THEN
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
