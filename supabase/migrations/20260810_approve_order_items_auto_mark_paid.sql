-- Book order payment is verified upfront (screenshot + amount reviewed via
-- confirm_product_order_payment) BEFORE any items can be approved into an
-- invoice — so by the time approve_order_items runs, the money has already
-- been confirmed received. Requiring a separate manual "Mark Paid" click on
-- the resulting invoice was redundant and confusing (Goghul: "so need to
-- mark payment again right?"). Auto-mark the invoice paid here instead,
-- reusing mark_invoice_paid (nested SECURITY DEFINER call, same pattern as
-- create_invoice) so its existing trigger (sync_order_items_on_invoice_paid)
-- correctly cascades product_order_items.line_status to 'paid'. This does
-- NOT change manually-created invoices elsewhere in Sales — those still
-- require an explicit Mark Paid, since there's no prior payment verification
-- for them.

CREATE OR REPLACE FUNCTION public.approve_order_items(p_order_id uuid, p_item_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_status text;
  v_school_id uuid;
  v_order_payment_mode text;
  v_school_name text;
  v_school_address text;
  v_school_state text;
  v_invoice_payment_method text;
  v_line_items jsonb;
  v_item record;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_count integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status, school_id, payment_mode INTO v_payment_status, v_school_id, v_order_payment_mode
  FROM product_orders WHERE id = p_order_id;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_payment_status != 'confirmed' THEN
    RAISE EXCEPTION 'Order payment must be confirmed before invoicing';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE id = ANY(p_item_ids) AND order_id = p_order_id AND line_status = 'pending';
  IF v_count != array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected items are not pending on this order';
  END IF;

  -- Re-check live stock — catches the rare race/count-error case; create_invoice's own
  -- stock decrement is warn-don't-block by design (matches every other invoice), so this
  -- is a courtesy early-exit, not the last line of defense.
  FOR v_item IN
    SELECT oi.id, oi.quantity, p.stock_quantity
    FROM product_order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.id = ANY(p_item_ids)
  LOOP
    IF v_item.quantity > v_item.stock_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for one of the selected items — reject it instead';
    END IF;
  END LOOP;

  SELECT school_name, school_address, state INTO v_school_name, v_school_address, v_school_state
  FROM schools WHERE id = v_school_id;

  v_invoice_payment_method := CASE v_order_payment_mode
    WHEN 'UPI' THEN 'UPI'
    WHEN 'NEFT' THEN 'Online Transfer'
    ELSE 'Online Transfer'
  END;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'item_name', p.name,
    'hsn_code', p.hsn_code,
    'gst_rate', p.gst_rate,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price
  ))
  INTO v_line_items
  FROM product_order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.id = ANY(p_item_ids);

  v_invoice_result := create_invoice(
    v_school_id, NULL, v_school_name, v_school_address, v_school_state, NULL,
    v_invoice_payment_method, v_line_items
  );
  v_invoice_id := (v_invoice_result->>'id')::uuid;

  UPDATE product_order_items
  SET invoice_id = v_invoice_id, line_status = 'invoiced_unpaid'
  WHERE id = ANY(p_item_ids);

  -- Payment was already verified before approval was possible — mark the
  -- invoice paid immediately. Runs after the UPDATE above so the trigger's
  -- cascade (invoiced_unpaid -> paid) finds the items it needs to flip.
  PERFORM mark_invoice_paid(v_invoice_id, true);

  RETURN v_invoice_id;
END;
$function$;
