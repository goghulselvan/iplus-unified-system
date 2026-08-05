-- Phase 5 of inventory module rebuild: internal stock issuance (no sale/
-- invoice attached — e.g. handing out consumables to students/staff).

CREATE TABLE IF NOT EXISTS public.inventory_item_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  issued_to_type text NOT NULL CHECK (issued_to_type IN ('student', 'staff', 'other')),
  issued_to_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  issued_by uuid,
  issue_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_item_issues ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_item_issues_product_id ON public.inventory_item_issues(product_id);

DROP POLICY IF EXISTS "inventory_item_issues_select" ON public.inventory_item_issues;
CREATE POLICY "inventory_item_issues_select" ON public.inventory_item_issues FOR SELECT USING (is_crm_user());
-- No write policy — all writes via issue_item (SECURITY DEFINER).

-- ── issue_item ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_item(
  p_product_id uuid,
  p_issued_to_type text,
  p_issued_to_name text,
  p_quantity integer,
  p_notes text
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
  IF p_issued_to_name IS NULL OR trim(p_issued_to_name) = '' THEN
    RAISE EXCEPTION 'Issued-to name is required';
  END IF;
  IF p_issued_to_type NOT IN ('student', 'staff', 'other') THEN
    RAISE EXCEPTION 'Invalid issued_to_type';
  END IF;

  INSERT INTO inventory_item_issues (product_id, issued_to_type, issued_to_name, quantity, issued_by, notes)
  VALUES (p_product_id, p_issued_to_type, trim(p_issued_to_name), p_quantity, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity - p_quantity, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_item(uuid, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_item(uuid, text, text, integer, text) TO authenticated, service_role;
