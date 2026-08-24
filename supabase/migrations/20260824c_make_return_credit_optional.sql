-- Credit is not always owed on a return: a purely logistical fix (correct
-- invoice, wrong physical item shipped — the "wrong_item_shipped" case) has
-- no price gap to reconcile, since the school already paid the right amount
-- for the right item and just needs the physical mix-up corrected. Requiring
-- credit-issuance before a return could be marked received (added
-- 2026-08-24b) was right for cases like a genuinely wrong invoice line
-- (school owed real value back, no same-invoice fix available), but wrong
-- for this one — it would have forced an unneeded credit note into
-- existence just to let staff close out a return that never needed money to
-- move. Makes Issue Credit optional: a return can now go
-- requested -> received directly (no credit, matching a same-invoice
-- resend), or requested -> credit_issued -> received (credit first, for
-- cases where the school is genuinely owed value), staff's choice per return.
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
