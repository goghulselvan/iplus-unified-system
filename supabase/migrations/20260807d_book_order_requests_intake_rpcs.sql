-- ── submit_product_order ────────────────────────────────────────────────────
-- p_items shape: [{"product_id": "uuid", "quantity": 3}, ...]
CREATE OR REPLACE FUNCTION public.submit_product_order(
  p_school_id uuid,
  p_items jsonb,
  p_payment_amount numeric,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_stock integer;
  v_total numeric := 0;
BEGIN
  IF p_school_id IS NULL OR p_school_id IS DISTINCT FROM get_portal_school_id() THEN
    RAISE EXCEPTION 'Not authorized for this school';
  END IF;
  IF p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  INSERT INTO product_orders (
    school_id, notes, payment_amount, payment_mode, payment_date,
    payment_utr_reference, payment_account_holder_name, payment_screenshot_url
  ) VALUES (
    p_school_id, p_notes, p_payment_amount, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive';
    END IF;

    SELECT unit_price, stock_quantity INTO v_unit_price, v_stock
    FROM products WHERE id = v_product_id AND is_active = true;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Product not found or inactive';
    END IF;
    IF v_quantity > v_stock THEN
      RAISE EXCEPTION 'Requested quantity exceeds available stock for this product';
    END IF;

    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  RETURN v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_product_order(uuid, jsonb, numeric, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_product_order(uuid, jsonb, numeric, text, date, text, text, text, text) TO authenticated, service_role;

-- ── confirm_product_order_payment ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_product_order_payment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Order already confirmed';
  END IF;

  UPDATE product_orders
  SET payment_status = 'confirmed',
      confirmed_at = now(),
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now(),
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid) TO authenticated, service_role;

-- ── request_order_payment_resubmit ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_order_payment_resubmit(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Cannot request resubmit on an already-confirmed order';
  END IF;

  UPDATE product_orders
  SET payment_status = 'resubmit_requested',
      payment_review_note = trim(p_reason),
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_order_payment_resubmit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_order_payment_resubmit(uuid, text) TO authenticated, service_role;

-- ── resubmit_product_order_payment ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resubmit_product_order_payment(
  p_order_id uuid,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_status text;
BEGIN
  SELECT school_id, payment_status INTO v_school_id, v_status
  FROM product_orders WHERE id = p_order_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_school_id IS DISTINCT FROM get_portal_school_id() THEN
    RAISE EXCEPTION 'Not authorized for this order';
  END IF;
  IF v_status != 'resubmit_requested' THEN
    RAISE EXCEPTION 'This order is not awaiting resubmission';
  END IF;
  IF p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;

  UPDATE product_orders
  SET payment_mode = p_payment_mode,
      payment_date = p_payment_date,
      payment_utr_reference = p_payment_utr_reference,
      payment_account_holder_name = p_payment_account_holder_name,
      payment_screenshot_url = p_payment_screenshot_url,
      payment_status = 'pending',
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resubmit_product_order_payment(uuid, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_product_order_payment(uuid, text, date, text, text, text) TO authenticated, service_role;
