-- Manual Order Request form (staff taking a call/WhatsApp order) currently
-- hard-blocks out-of-stock or under-stocked products, both in the UI
-- (dropdown disables the product) and here in the RPC (raises an exception
-- if requested quantity exceeds current stock). That's wrong for this flow —
-- the order-review pipeline already handles per-item backorder correctly:
-- approve_order_items() only lets staff invoice items it can independently
-- verify are in stock, and any item that isn't just stays 'pending' on the
-- same order until restocked, with no effect on the order's other items.
-- Remove the creation-time block so staff can record what the school
-- actually ordered, backorders included, rather than being unable to create
-- the order request at all.
CREATE OR REPLACE FUNCTION public.create_manual_product_order(p_school_id uuid, p_items jsonb, p_payment_amount numeric, p_payment_mode text, p_payment_date date, p_payment_utr_reference text, p_payment_account_holder_name text, p_payment_screenshot_url text, p_notes text)
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
  IF p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO product_order_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  -- Staff self-attests the payment by entering it — lands straight in
  -- 'confirmed', skipping the review step that exists for school-submitted
  -- proofs (no one else needs to double-check the staff member's own entry).
  INSERT INTO product_orders (
    school_id, notes, payment_amount, payment_mode, payment_date,
    payment_utr_reference, payment_account_holder_name, payment_screenshot_url,
    order_number, fy, source, created_by,
    payment_status, confirmed_at, payment_reviewed_by, payment_reviewed_at
  ) VALUES (
    p_school_id, p_notes, p_payment_amount, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url,
    v_next, v_fy, 'manual', auth.uid(),
    'confirmed', now(), auth.uid(), now()
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
    -- No stock check here by design — out-of-stock/under-stocked lines are
    -- allowed through and simply wait as 'pending' until approve_order_items()
    -- can verify live stock at invoicing time.

    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  RETURN v_order_id;
END;
$function$;
