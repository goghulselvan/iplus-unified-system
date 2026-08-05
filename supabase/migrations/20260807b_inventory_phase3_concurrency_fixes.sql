-- Concurrency fixes: negative-stock guards were read-then-check-then-write
-- (race-prone under concurrent writes to the same product), and
-- delete_stock_adjustment had no atomic claim on the row being reversed
-- (a double-click could double-reverse it). Both fixed by reordering to
-- atomic-write-then-check, matching create_invoice's already-correct pattern,
-- and by making the DELETE itself the concurrency mutex.

-- ── add_stock ────────────────────────────────────────────────────────────────
-- Minor fix: "Product not found" was dead code — a bad product_id hit a raw
-- FK-violation error first, because the INSERT into inventory_stock_adds
-- (which has a FK to products) ran before the UPDATE that would have caught
-- it. Add an explicit existence check before the INSERT.
CREATE OR REPLACE FUNCTION public.add_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  INSERT INTO inventory_stock_adds (product_id, quantity, reason, added_by)
  VALUES (p_product_id, p_quantity, p_reason, auth.uid())
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity + p_quantity, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_stock(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_stock(uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_stock_adjustment(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  UPDATE products SET stock_quantity = stock_quantity + p_quantity_delta, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'This adjustment would make stock negative. Current stock: %.', v_new_stock - p_quantity_delta;
  END IF;

  INSERT INTO inventory_stock_adjustments (product_id, quantity_delta, reason, adjusted_by)
  VALUES (p_product_id, p_quantity_delta, p_reason, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_stock_adjustment(
  p_adjustment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_delta integer;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM inventory_stock_adjustments
  WHERE id = p_adjustment_id
  RETURNING product_id, quantity_delta INTO v_product_id, v_delta;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;

  UPDATE products SET stock_quantity = stock_quantity - v_delta, updated_at = now()
  WHERE id = v_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Cannot reverse this adjustment — it would make stock negative. Current stock: %.', v_new_stock + v_delta;
  END IF;

  RETURN jsonb_build_object('new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) TO authenticated, service_role;
