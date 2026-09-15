-- Sending a replacement physically takes the correct book off the shelf, but
-- mark_replacement_sent only ever stamped replacement_sent_at — stock never
-- moved, so every wrong-item cycle left inventory reading one book high
-- (mark_return_received already adds the returned wrong book back).
--
-- Now the dispatch is refused outright when there is nothing to send: you
-- cannot post a book you do not have, and recording it would be a dispatch
-- that never happened. Restock first, then mark it sent.
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
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
  v_stock integer;
  v_product_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same advisory-lock domain issue_credit_for_return / mark_return_received
  -- already use — serializes this against a concurrent second attempt.
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT reason_category, status, replacement_sent_at, quantity, invoice_line_item_id
  INTO v_reason_category, v_status, v_replacement_sent_at, v_quantity, v_line_item_id
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

  -- The replacement is the book the school ORDERED, not actual_product_id —
  -- that one is the wrong book coming back, restocked by mark_return_received.
  SELECT product_id INTO v_product_id
  FROM invoice_line_items WHERE id = v_line_item_id;

  -- Free-text invoice lines carry no catalog product, so there is no stock row
  -- to move; record the dispatch and leave inventory alone.
  IF v_product_id IS NOT NULL THEN
    -- Guard and decrement in one statement, the same atomic pattern the stock
    -- adjustment RPCs use — a separate check-then-update lets two concurrent
    -- replacements for the same product both pass the check and oversell.
    UPDATE products SET stock_quantity = stock_quantity - v_quantity
    WHERE id = v_product_id AND stock_quantity >= v_quantity;
    IF NOT FOUND THEN
      SELECT stock_quantity, name INTO v_stock, v_product_name
      FROM products WHERE id = v_product_id;
      RAISE EXCEPTION 'Only % in stock for % — restock before sending the replacement (need %)',
        COALESCE(v_stock, 0), COALESCE(v_product_name, 'this item'), v_quantity;
    END IF;
  END IF;

  UPDATE product_returns
  SET replacement_sent_at = now(), replacement_sent_by = auth.uid(),
      replacement_order_reference = NULLIF(trim(p_reference), '')
  WHERE id = p_return_id;
END;
$function$;
