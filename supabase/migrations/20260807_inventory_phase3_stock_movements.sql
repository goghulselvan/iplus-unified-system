-- Phase 3 of inventory module rebuild: manual stock-in and reversible
-- stock adjustments.

CREATE TABLE IF NOT EXISTS public.inventory_stock_adds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  added_by uuid,
  added_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_stock_adds ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_stock_adds_product_id ON public.inventory_stock_adds(product_id);

DROP POLICY IF EXISTS "inventory_stock_adds_select" ON public.inventory_stock_adds;
CREATE POLICY "inventory_stock_adds_select" ON public.inventory_stock_adds FOR SELECT USING (is_crm_user());
-- No write policy — all writes via add_stock (SECURITY DEFINER).

CREATE TABLE IF NOT EXISTS public.inventory_stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity_delta integer NOT NULL CHECK (quantity_delta != 0),
  reason text NOT NULL,
  adjusted_by uuid,
  adjusted_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_stock_adjustments_product_id ON public.inventory_stock_adjustments(product_id);

DROP POLICY IF EXISTS "inventory_stock_adjustments_select" ON public.inventory_stock_adjustments;
CREATE POLICY "inventory_stock_adjustments_select" ON public.inventory_stock_adjustments FOR SELECT USING (is_crm_user());
-- No write policy — all writes via create_stock_adjustment/delete_stock_adjustment (SECURITY DEFINER).

-- ── add_stock ────────────────────────────────────────────────────────────────
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

-- ── create_stock_adjustment ─────────────────────────────────────────────────
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
  v_current_stock integer;
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

  SELECT stock_quantity INTO v_current_stock FROM products WHERE id = p_product_id;
  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_current_stock + p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'This adjustment would make stock negative. Current stock: %.', v_current_stock;
  END IF;

  INSERT INTO inventory_stock_adjustments (product_id, quantity_delta, reason, adjusted_by)
  VALUES (p_product_id, p_quantity_delta, p_reason, auth.uid())
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity + p_quantity_delta, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) TO authenticated, service_role;

-- ── delete_stock_adjustment ──────────────────────────────────────────────────
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
  v_current_stock integer;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT product_id, quantity_delta INTO v_product_id, v_delta
  FROM inventory_stock_adjustments WHERE id = p_adjustment_id;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;

  SELECT stock_quantity INTO v_current_stock FROM products WHERE id = v_product_id;

  -- Reversing means subtracting the original delta back out.
  IF v_current_stock - v_delta < 0 THEN
    RAISE EXCEPTION 'Cannot reverse this adjustment — it would make stock negative. Current stock: %.', v_current_stock;
  END IF;

  UPDATE products SET stock_quantity = stock_quantity - v_delta, updated_at = now()
  WHERE id = v_product_id
  RETURNING stock_quantity INTO v_new_stock;

  DELETE FROM inventory_stock_adjustments WHERE id = p_adjustment_id;

  RETURN jsonb_build_object('new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) TO authenticated, service_role;
