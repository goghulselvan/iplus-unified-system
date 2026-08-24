-- Splits "Confirm Receipt" (mint credit + fix stock, both at once) into two
-- independent, sequential steps: Issue Credit (immediate — the school needs
-- the correct book now, doesn't need to wait for the wrong one's return
-- journey to finish) and Mark Received (later, stock only, once the wrong
-- book is actually back). Deliberate trade-off: credit exists before the
-- book is physically confirmed back — see the design spec for why.

ALTER TABLE public.product_returns DROP CONSTRAINT product_returns_status_check;
ALTER TABLE public.product_returns ADD CONSTRAINT product_returns_status_check
  CHECK (status IN ('requested', 'credit_issued', 'received'));

ALTER TABLE public.product_returns DROP CONSTRAINT product_returns_condition_set_on_receipt;
ALTER TABLE public.product_returns ADD CONSTRAINT product_returns_condition_set_on_receipt
  CHECK (
    (status IN ('requested', 'credit_issued') AND condition_on_receipt IS NULL) OR
    (status = 'received' AND condition_on_receipt IS NOT NULL)
  );

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
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same advisory-lock domain mark_return_received will also use — serializes
  -- this against a concurrent second attempt to issue credit for the same return.
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id INTO v_status, v_quantity, v_line_item_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'Credit has already been issued for this return';
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

REVOKE EXECUTE ON FUNCTION public.issue_credit_for_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_for_return(uuid) TO authenticated, service_role;

-- confirm_return_received's behavior fundamentally changes (no longer mints
-- anything — that moved above), so this is a rename, not an in-place edit;
-- the old name would be actively misleading once it stops "confirming" a
-- receipt-and-credit event and only does the stock half.
DROP FUNCTION IF EXISTS public.confirm_return_received(uuid, text);

CREATE OR REPLACE FUNCTION public.mark_return_received(p_return_id uuid, p_condition text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
  v_actual_product_id uuid;
  v_restock_product_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_condition NOT IN ('resellable', 'damaged') THEN
    RAISE EXCEPTION 'Condition must be resellable or damaged';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id, actual_product_id
  INTO v_status, v_quantity, v_line_item_id, v_actual_product_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status = 'requested' THEN
    RAISE EXCEPTION 'Issue credit before marking this return as received';
  END IF;
  IF v_status = 'received' THEN
    RAISE EXCEPTION 'This return has already been received';
  END IF;

  SELECT product_id INTO v_product_id FROM invoice_line_items WHERE id = v_line_item_id;

  -- Same routing already live for wrong-item-shipped returns: restock
  -- whichever product actually needs it, not always the invoiced one.
  v_restock_product_id := COALESCE(v_actual_product_id, v_product_id);

  IF p_condition = 'resellable' THEN
    IF v_restock_product_id IS NULL THEN
      RAISE EXCEPTION 'This line has no catalog product — it cannot be restocked; record it as damaged instead';
    END IF;
    UPDATE products SET stock_quantity = stock_quantity + v_quantity
    WHERE id = v_restock_product_id;
  END IF;

  UPDATE product_returns
  SET status = 'received', condition_on_receipt = p_condition, received_by = auth.uid(), received_at = now()
  WHERE id = p_return_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_return_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_return_received(uuid, text) TO authenticated, service_role;
