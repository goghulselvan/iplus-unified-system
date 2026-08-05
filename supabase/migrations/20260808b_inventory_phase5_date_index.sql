-- Phase 5 review fixes: supporting index for the Item Issue list page's
-- actual query (ORDER BY issue_date DESC, created_at DESC, no filter), plus
-- issue_item() hardening (friendly "Product not found", NULL-blind
-- validation guards, notes sanitization).

CREATE INDEX IF NOT EXISTS idx_inventory_item_issues_date ON public.inventory_item_issues (issue_date DESC, created_at DESC);

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
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF p_issued_to_name IS NULL OR trim(p_issued_to_name) = '' THEN
    RAISE EXCEPTION 'Issued-to name is required';
  END IF;
  IF p_issued_to_type IS NULL OR p_issued_to_type NOT IN ('student', 'staff', 'other') THEN
    RAISE EXCEPTION 'Invalid issued_to_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  INSERT INTO inventory_item_issues (product_id, issued_to_type, issued_to_name, quantity, issued_by, notes)
  VALUES (p_product_id, p_issued_to_type, trim(p_issued_to_name), p_quantity, auth.uid(), NULLIF(trim(p_notes), ''))
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
