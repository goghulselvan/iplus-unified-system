-- Edit Order Items dialog: also allow correcting the recorded payment DATE
-- (not just the amount) on a manual, still-pre-invoice book order.
-- Adds p_new_payment_date; DROP first because CREATE OR REPLACE can't widen the
-- arg list without leaving both overloads live ("function is not unique").

BEGIN;

DROP FUNCTION IF EXISTS public.update_manual_order_items(uuid, jsonb, numeric);

CREATE OR REPLACE FUNCTION public.update_manual_order_items(
  p_order_id           uuid,
  p_items              jsonb,
  p_new_payment_amount numeric DEFAULT NULL,
  p_new_payment_date   date    DEFAULT NULL
) RETURNS numeric
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_ord   product_orders%ROWTYPE;
  v_item  jsonb;
  v_pid   uuid;
  v_qty   integer;
  v_price numeric;
  v_total numeric := 0;
  v_old   jsonb;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_ord FROM product_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_ord.source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'Only manually-entered orders can be edited here';
  END IF;
  IF v_ord.applied_credit_note_id IS NOT NULL THEN
    RAISE EXCEPTION 'This order has an applied credit note — adjust the credit before editing items';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_order_items
    WHERE order_id = p_order_id
      AND (line_status <> 'pending' OR invoice_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'This order can no longer be edited — one or more items are already invoiced or rejected';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', poi.product_id,
           'product',    (SELECT name FROM products WHERE id = poi.product_id),
           'quantity',   poi.quantity,
           'unit_price', poi.unit_price))
    INTO v_old
  FROM product_order_items poi
  WHERE poi.order_id = p_order_id;

  DELETE FROM product_order_items WHERE order_id = p_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive number';
    END IF;
    SELECT unit_price INTO v_price
    FROM products WHERE id = v_pid AND is_active = true;
    IF v_price IS NULL THEN
      RAISE EXCEPTION 'Product % not found or inactive', v_pid;
    END IF;
    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (p_order_id, v_pid, v_qty, v_price);
    v_total := v_total + v_price * v_qty;
  END LOOP;

  IF p_new_payment_amount IS NOT NULL THEN
    IF p_new_payment_amount < 0 THEN
      RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;
    UPDATE product_orders SET payment_amount = p_new_payment_amount WHERE id = p_order_id;
  END IF;

  IF p_new_payment_date IS NOT NULL THEN
    UPDATE product_orders SET payment_date = p_new_payment_date WHERE id = p_order_id;
  END IF;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    auth.uid(), 'MANUAL_ORDER_ITEMS_EDITED', 'product_orders', p_order_id,
    jsonb_build_object('items', v_old,
                       'payment_amount', v_ord.payment_amount,
                       'payment_date', v_ord.payment_date),
    jsonb_build_object('items', p_items, 'new_total', v_total,
                       'payment_amount', COALESCE(p_new_payment_amount, v_ord.payment_amount),
                       'payment_date', COALESCE(p_new_payment_date, v_ord.payment_date))
  );

  RETURN v_total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_manual_order_items(uuid, jsonb, numeric, date) TO PUBLIC;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260910', 'update_manual_order_items_payment_date')
ON CONFLICT (version) DO NOTHING;

COMMIT;
