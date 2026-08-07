-- Restrict stock quantity manipulation (Add Stock, Stock Adjustment create/reverse) to
-- superadmin only, per Goghul: "stock adjustments to add or delete stock is superadmin
-- gated" — staff keep unrestricted access to the Sales workflow itself (create invoice,
-- confirm/approve/reject book orders), only direct stock-quantity edits are locked down.
-- Matches void_invoice's existing role-check pattern (profiles.role via auth.uid()),
-- restricted to 'superadmin' only rather than 'superadmin'/'accountant'.

CREATE OR REPLACE FUNCTION public.add_stock(p_product_id uuid, p_quantity integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_id uuid;
  v_new_stock integer;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role != 'superadmin' THEN
    RAISE EXCEPTION 'Not authorized — only superadmin can add stock';
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

CREATE OR REPLACE FUNCTION public.create_stock_adjustment(p_product_id uuid, p_quantity_delta integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_id uuid;
  v_new_stock integer;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role != 'superadmin' THEN
    RAISE EXCEPTION 'Not authorized — only superadmin can adjust stock';
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

CREATE OR REPLACE FUNCTION public.delete_stock_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_product_id uuid;
  v_delta integer;
  v_new_stock integer;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role != 'superadmin' THEN
    RAISE EXCEPTION 'Not authorized — only superadmin can reverse a stock adjustment';
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
