-- Manual Order Request: lets CRM staff create a book order on behalf of a
-- school that contacted them offline (phone/WhatsApp), entering the payment
-- proof themselves. Reuses the entire existing review/approve/invoice/
-- dispatch pipeline unchanged — this only adds the intake path.

-- Origin tracking, so staff can tell at a glance which orders they entered
-- themselves vs. what a school submitted through the portal.
ALTER TABLE product_orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal';
ALTER TABLE product_orders ADD CONSTRAINT product_orders_source_check CHECK (source IN ('portal', 'manual'));
ALTER TABLE product_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Staff need to upload a payment screenshot on the school's behalf. Only
-- superadmin and the portal (scoped to its own school folder) could write
-- to this bucket before.
DROP POLICY IF EXISTS "crm_staff_upload_payment_proof" ON storage.objects;
CREATE POLICY "crm_staff_upload_payment_proof" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'payment-proofs' AND is_crm_user());

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
  v_stock integer;
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
