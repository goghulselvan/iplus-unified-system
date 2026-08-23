-- Wire credit note application into Manual Order Requests and their approval.
--
-- Adds two trailing, optional params to create_manual_product_order so staff can
-- apply an existing credit note (minted via report_return + confirm_return_received)
-- toward a replacement order for the same school — the net-zero "send a correct
-- item to replace a wrong one" case. Existing call sites (9 positional args) are
-- unaffected since both new params default to NULL.
--
-- Also updates approve_order_items so that when the order it's invoicing carries
-- an applied credit, it records a credit_note_applications row against the
-- invoice it creates, guarded by credit_applied_to_invoice so a later partial
-- approval on the same order (a second invoice) never double-records it.
--
-- create_manual_product_order's signature is changing (2 new trailing DEFAULT
-- NULL params), which means CREATE OR REPLACE FUNCTION below does NOT replace
-- the existing 9-arg function in place — Postgres treats a different parameter
-- list as a distinct overload and would leave both versions live side by side.
-- With both present, any existing call site passing exactly 9 positional args
-- becomes ambiguous ("function ... is not unique") between the old exact-arity
-- function and the new one using its trailing defaults, breaking every existing
-- caller. Drop the old 9-arg signature explicitly first so only the new,
-- backward-compatible 11-arg version remains.
DROP FUNCTION IF EXISTS public.create_manual_product_order(
  uuid, jsonb, numeric, text, date, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.create_manual_product_order(
  p_school_id uuid, p_items jsonb, p_payment_amount numeric, p_payment_mode text,
  p_payment_date date, p_payment_utr_reference text, p_payment_account_holder_name text,
  p_payment_screenshot_url text, p_notes text,
  p_credit_note_id uuid DEFAULT NULL, p_credit_amount numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_fy smallint;
  v_next integer;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_total numeric := 0;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found';
  END IF;
  IF p_payment_amount > 0 AND (p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '') THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF p_credit_note_id IS NOT NULL THEN
    IF p_credit_amount IS NULL OR p_credit_amount <= 0 THEN
      RAISE EXCEPTION 'Credit amount must be positive when a credit note is applied';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM credit_notes_with_balance
      WHERE id = p_credit_note_id AND school_id = p_school_id AND remaining_balance >= p_credit_amount
    ) THEN
      RAISE EXCEPTION 'Credit note does not belong to this school or has insufficient balance';
    END IF;
  END IF;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO product_order_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO product_orders (
    school_id, notes, payment_amount, payment_mode, payment_date,
    payment_utr_reference, payment_account_holder_name, payment_screenshot_url,
    order_number, fy, source, created_by,
    payment_status, confirmed_at, payment_reviewed_by, payment_reviewed_at,
    applied_credit_note_id, applied_credit_amount
  ) VALUES (
    p_school_id, p_notes, p_payment_amount, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url,
    v_next, v_fy, 'manual', auth.uid(),
    'confirmed', now(), auth.uid(), now(),
    p_credit_note_id, p_credit_amount
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive';
    END IF;

    SELECT unit_price INTO v_unit_price
    FROM products WHERE id = v_product_id AND is_active = true;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Product not found or inactive';
    END IF;

    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  RETURN v_order_id;
END;
$function$;

-- Second change: approve_order_items records the credit application against
-- whichever invoice it creates first for an order that carries applied credit,
-- guarded by credit_applied_to_invoice so a later partial-approval on the same
-- order (a second invoice) never double-records it.
CREATE OR REPLACE FUNCTION public.approve_order_items(p_order_id uuid, p_item_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_credit_note_id uuid;
  v_credit_amount numeric;
  v_credit_already_applied boolean;
  v_credit_balance numeric;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status, school_id, payment_mode, applied_credit_note_id, applied_credit_amount, credit_applied_to_invoice
  INTO v_payment_status, v_school_id, v_order_payment_mode, v_credit_note_id, v_credit_amount, v_credit_already_applied
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
  -- (Restored from the live function — supabase/migrations/20260810_approve_order_items_auto_mark_paid.sql
  -- added this after this plan's original reference copy of approve_order_items was read;
  -- omitting it here would have silently regressed a real, already-shipped fix.)
  PERFORM mark_invoice_paid(v_invoice_id, true);

  IF v_credit_note_id IS NOT NULL AND NOT v_credit_already_applied THEN
    -- Re-validate the credit note's balance here, at the moment it's actually
    -- spent — not just at order-creation time. Two different manual orders can
    -- both reference the same credit note before either is approved (each
    -- independently passed create_manual_product_order's balance check, since
    -- neither had actually consumed anything yet); without this re-check and
    -- lock, both could be approved and both would successfully record a
    -- credit_note_applications row, double-spending the credit. The lock
    -- serializes concurrent approve_order_items calls that reference the same
    -- credit note; the balance re-check catches the case where an earlier,
    -- already-committed order legitimately used up the balance first.
    PERFORM pg_advisory_xact_lock(hashtext(v_credit_note_id::text));

    SELECT remaining_balance INTO v_credit_balance
    FROM credit_notes_with_balance WHERE id = v_credit_note_id;

    IF v_credit_balance < v_credit_amount THEN
      RAISE EXCEPTION 'Credit note no longer has sufficient balance (% remaining, % required) — another order may have already used it; remove or reduce the applied credit on this order and retry',
        v_credit_balance, v_credit_amount;
    END IF;

    INSERT INTO credit_note_applications (credit_note_id, application_type, amount, applied_to_invoice_id, recorded_by)
    VALUES (v_credit_note_id, 'invoice', v_credit_amount, v_invoice_id, auth.uid());

    UPDATE product_orders SET credit_applied_to_invoice = true WHERE id = p_order_id;
  END IF;

  RETURN v_invoice_id;
END;
$$;
