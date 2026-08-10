-- Human-readable order reference number (ORD/{fy}-{fy+1}/{seq}), for support/
-- complaint lookups and any future dispatch notification — mirrors the
-- existing invoice numbering pattern (invoice_fy_counters / INV/{fy}-{fy+1}/{n})
-- exactly: per-financial-year atomic counter, IST-aware, FY starts April.

CREATE TABLE IF NOT EXISTS product_order_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);

ALTER TABLE product_orders ADD COLUMN IF NOT EXISTS order_number integer;
ALTER TABLE product_orders ADD COLUMN IF NOT EXISTS fy smallint;

-- Backfill existing orders in creation order, seeding the counter so future
-- inserts continue the same sequence without colliding.
DO $$
DECLARE
  v_row record;
  v_fy smallint;
  v_next integer;
BEGIN
  FOR v_row IN SELECT id, created_at FROM product_orders WHERE order_number IS NULL ORDER BY created_at LOOP
    v_fy := (EXTRACT(YEAR FROM (v_row.created_at AT TIME ZONE 'Asia/Kolkata'))::int % 100);
    IF EXTRACT(MONTH FROM (v_row.created_at AT TIME ZONE 'Asia/Kolkata'))::int < 4 THEN
      v_fy := v_fy - 1;
    END IF;
    INSERT INTO product_order_fy_counters AS c (fy, last_no)
    VALUES (v_fy, 1)
    ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
    RETURNING c.last_no INTO v_next;
    UPDATE product_orders SET order_number = v_next, fy = v_fy WHERE id = v_row.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.submit_product_order(p_school_id uuid, p_items jsonb, p_payment_amount numeric, p_payment_mode text, p_payment_date date, p_payment_utr_reference text, p_payment_account_holder_name text, p_payment_screenshot_url text, p_notes text)
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
    order_number, fy
  ) VALUES (
    p_school_id, p_notes, p_payment_amount, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url,
    v_next, v_fy
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
$function$;
