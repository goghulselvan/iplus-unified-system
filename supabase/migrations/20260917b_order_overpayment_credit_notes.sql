-- When a school pays more than its book order, the surplus becomes a credit
-- note it can spend on a later order or have refunded. Until now the surplus
-- lived only as free text in product_orders.notes ("refund needed"), which
-- nothing reads — ORD/26-27/79 paid Rs.720 over at student rates.
--
-- The amount is always computed here, never typed by staff:
--   received (verified or recorded amount + credit applied)
--   − order total (all lines, at the price on the order)
--   − overpayment credit already issued from this order
-- so the same surplus can't be turned into two credit notes.
-- Rejected lines deliberately don't count (Goghul, 2026-09-17): only money
-- paid above the order total.

ALTER TABLE public.credit_notes
  ADD COLUMN source_order_id uuid REFERENCES public.product_orders(id);

CREATE INDEX credit_notes_source_order_id_idx
  ON public.credit_notes (source_order_id) WHERE source_order_id IS NOT NULL;

ALTER TABLE public.credit_notes DROP CONSTRAINT credit_notes_source_check;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_source_check
  CHECK (source IN ('return', 'advance_payment', 'order_overpayment'));

ALTER TABLE public.credit_notes DROP CONSTRAINT credit_notes_source_shape;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_source_shape CHECK (
  (source = 'return'            AND source_return_id IS NOT NULL AND source_order_id IS NULL)
  OR (source = 'advance_payment'   AND source_return_id IS NULL     AND source_order_id IS NULL)
  OR (source = 'order_overpayment' AND source_return_id IS NULL     AND source_order_id IS NOT NULL)
);

CREATE OR REPLACE VIEW public.credit_notes_with_balance AS
 SELECT id,
    credit_note_number,
    fy,
    school_id,
    source_return_id,
    amount,
    note,
    created_by,
    created_at,
    amount - COALESCE(( SELECT sum(ca.amount) AS sum
           FROM credit_note_applications ca
          WHERE ca.credit_note_id = cn.id), 0::numeric) AS remaining_balance,
    source,
    payment_mode,
    payment_date,
    payment_reference,
    payment_screenshot_url,
    source_order_id
   FROM credit_notes cn;

CREATE OR REPLACE FUNCTION public.order_overpayment_excess(p_order_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN o.payment_status <> 'confirmed' THEN 0 ELSE GREATEST(
      COALESCE(o.verified_amount, o.payment_amount, 0) + COALESCE(o.applied_credit_amount, 0)
    - COALESCE((SELECT sum(i.quantity * i.unit_price) FROM product_order_items i WHERE i.order_id = o.id), 0)
    - COALESCE((SELECT sum(cn.amount) FROM credit_notes cn
                WHERE cn.source = 'order_overpayment' AND cn.source_order_id = o.id), 0),
    0) END
  FROM product_orders o
  WHERE o.id = p_order_id;
$function$;

REVOKE ALL ON FUNCTION public.order_overpayment_excess(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_overpayment_excess(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_overpayment_credit_note(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ist    timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_order  product_orders%ROWTYPE;
  v_excess numeric;
  v_fy     smallint;
  v_next   integer;
  v_id     uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Row lock serializes two staff clicking Issue on the same order at once;
  -- the second then sees the first credit note and finds nothing left.
  SELECT * INTO v_order FROM product_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_excess := order_overpayment_excess(p_order_id);
  IF v_excess <= 0 THEN
    RAISE EXCEPTION 'This order has no overpayment left to credit';
  END IF;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;

  INSERT INTO credit_note_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO credit_notes (
    credit_note_number, fy, school_id, source_return_id, source_order_id, amount, note,
    source, payment_mode, payment_date, payment_reference, payment_screenshot_url,
    created_by
  ) VALUES (
    v_next, v_fy, v_order.school_id, NULL, p_order_id, v_excess,
    format('Paid more than book order ORD/%s-%s/%s', v_order.fy, v_order.fy + 1, v_order.order_number),
    'order_overpayment', v_order.payment_mode, v_order.payment_date,
    v_order.payment_utr_reference, v_order.payment_screenshot_url,
    auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM log_security_action(
    'ORDER_OVERPAYMENT_CREDIT_NOTE_CREATED', 'credit_notes', v_id, NULL,
    jsonb_build_object(
      'order_id', p_order_id, 'school_id', v_order.school_id, 'amount', v_excess,
      'received', COALESCE(v_order.verified_amount, v_order.payment_amount),
      'applied_credit_amount', v_order.applied_credit_amount
    )
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_overpayment_credit_note(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_overpayment_credit_note(uuid) TO authenticated;

-- Once a surplus has been handed back as credit, changing the order's items or
-- amount would leave that credit note wrong, so the order is frozen — same rule
-- as an order that spent a credit note.
CREATE OR REPLACE FUNCTION public.update_manual_order_items(p_order_id uuid, p_items jsonb, p_new_payment_amount numeric DEFAULT NULL::numeric, p_new_payment_date date DEFAULT NULL::date)
 RETURNS numeric
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
    SELECT 1 FROM credit_notes WHERE source = 'order_overpayment' AND source_order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'A credit note was already issued for this order''s overpayment, so its items and amount are locked';
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
