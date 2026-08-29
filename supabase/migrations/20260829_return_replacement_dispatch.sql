-- Returns had no way to record that the CORRECT item was actually sent to the
-- school for a wrong_item_shipped case. The only two exits were Issue Credit
-- (money back) and Mark Received (the wrong item physically came back) —
-- neither answers "did we ship the replacement?", so a return could sit
-- resolved-looking in the CRM while the school was still owed a book.
-- Concrete case: Baliah Marthandam (SS 3005) ordered 2× Class 7 Mock Test,
-- got 2× Class 8 Mock Test shipped instead — two later orders went out for
-- that school and neither one included the replacement, with nothing in the
-- Returns page surfacing that gap.

ALTER TABLE public.product_returns
  ADD COLUMN IF NOT EXISTS replacement_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS replacement_sent_by uuid,
  ADD COLUMN IF NOT EXISTS replacement_order_reference text;

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

-- Issuing a credit after a replacement was already sent would double-resolve
-- the same return (school gets both the book and the money) — block it the
-- same way mark_return_received's own status check blocks a re-receive.
CREATE OR REPLACE FUNCTION public.issue_credit_for_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_unit_price numeric;
  v_invoice_id uuid;
  v_school_id uuid;
  v_credit_amount numeric;
  v_fy smallint;
  v_next integer;
  v_credit_note_id uuid;
  v_replacement_sent_at timestamptz;
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id, replacement_sent_at
  INTO v_status, v_quantity, v_line_item_id, v_replacement_sent_at
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'Credit has already been issued for this return';
  END IF;
  IF v_replacement_sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'A replacement was already sent for this return instead of a credit';
  END IF;

  SELECT unit_price, invoice_id INTO v_unit_price, v_invoice_id
  FROM invoice_line_items WHERE id = v_line_item_id;

  SELECT school_id INTO v_school_id FROM invoices WHERE id = v_invoice_id;

  v_credit_amount := v_unit_price * v_quantity;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO credit_note_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO credit_notes (credit_note_number, fy, school_id, source_return_id, amount, created_by)
  VALUES (v_next, v_fy, v_school_id, p_return_id, v_credit_amount, auth.uid())
  RETURNING id INTO v_credit_note_id;

  UPDATE product_returns SET status = 'credit_issued' WHERE id = p_return_id;

  RETURN v_credit_note_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_replacement_sent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_replacement_sent(uuid, text) TO authenticated, service_role;
