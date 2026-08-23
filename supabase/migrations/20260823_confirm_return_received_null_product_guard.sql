-- Final whole-branch review finding: a "Custom item…" invoice line has
-- product_id = NULL (InvoiceDialog.tsx allows this). confirm_return_received
-- would silently UPDATE 0 rows on such a line when marked "resellable", mint
-- the credit note anyway, and permanently record condition_on_receipt =
-- 'resellable' — a false claim that stock was restored, with no error.
-- Guard it the same way an unresellable/damaged item is already handled
-- deliberately (no stock change), just with an explicit rejection instead of
-- a silent no-op.
CREATE OR REPLACE FUNCTION public.confirm_return_received(p_return_id uuid, p_condition text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
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

  IF p_condition NOT IN ('resellable', 'damaged') THEN
    RAISE EXCEPTION 'Condition must be resellable or damaged';
  END IF;

  -- Advisory lock to serialize concurrent status checks on same return id
  -- Prevents TOCTOU race where two concurrent calls could both read 'requested' status,
  -- both pass the check, and both mint credit notes / restore stock
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id INTO v_status, v_quantity, v_line_item_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'This return has already been received';
  END IF;

  SELECT product_id, unit_price, invoice_id INTO v_product_id, v_unit_price, v_invoice_id
  FROM invoice_line_items WHERE id = v_line_item_id;

  SELECT school_id INTO v_school_id FROM invoices WHERE id = v_invoice_id;

  IF p_condition = 'resellable' THEN
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'This line has no catalog product — it cannot be restocked; record it as damaged instead';
    END IF;
    UPDATE products SET stock_quantity = stock_quantity + v_quantity
    WHERE id = v_product_id;
  END IF;

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

  UPDATE product_returns
  SET status = 'received', condition_on_receipt = p_condition, received_by = auth.uid(), received_at = now()
  WHERE id = p_return_id;

  RETURN v_credit_note_id;
END;
$function$;
