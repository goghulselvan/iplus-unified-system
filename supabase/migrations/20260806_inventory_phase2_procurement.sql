-- Phase 2 of inventory module rebuild: procurement (suppliers, purchase
-- orders, goods-received reconciliation, supplier payments).

-- ── inventory_suppliers ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  gstin text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_suppliers_select" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_select" ON public.inventory_suppliers FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "inventory_suppliers_insert" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_insert" ON public.inventory_suppliers FOR INSERT WITH CHECK (is_crm_user());
DROP POLICY IF EXISTS "inventory_suppliers_update" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_update" ON public.inventory_suppliers FOR UPDATE USING (is_crm_user());
DROP POLICY IF EXISTS "inventory_suppliers_delete" ON public.inventory_suppliers;
CREATE POLICY "inventory_suppliers_delete" ON public.inventory_suppliers FOR DELETE USING (is_crm_user());

-- ── inventory_purchase_orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number integer GENERATED ALWAYS AS IDENTITY,
  supplier_id uuid NOT NULL REFERENCES public.inventory_suppliers(id),
  order_date date NOT NULL DEFAULT current_date,
  expected_date date,
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_po_select" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_po_select" ON public.inventory_purchase_orders FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "inventory_po_update" ON public.inventory_purchase_orders;
CREATE POLICY "inventory_po_update" ON public.inventory_purchase_orders FOR UPDATE USING (is_crm_user());
-- No insert policy — creation only via create_purchase_order (SECURITY DEFINER).
-- No delete policy — cancel via status update, never hard-delete a PO with history.

-- ── inventory_po_items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.inventory_purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  unit_cost numeric NOT NULL CHECK (unit_cost >= 0),
  row_order integer NOT NULL
);
ALTER TABLE public.inventory_po_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_po_items_po_id ON public.inventory_po_items(purchase_order_id);

DROP POLICY IF EXISTS "inventory_po_items_select" ON public.inventory_po_items;
CREATE POLICY "inventory_po_items_select" ON public.inventory_po_items FOR SELECT USING (is_crm_user());
-- No write policy — all writes via create_purchase_order (SECURITY DEFINER).

-- ── inventory_grn (goods received notes) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_grn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number integer GENERATED ALWAYS AS IDENTITY,
  purchase_order_id uuid NOT NULL REFERENCES public.inventory_purchase_orders(id),
  received_date date NOT NULL DEFAULT current_date,
  received_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_grn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_grn_select" ON public.inventory_grn;
CREATE POLICY "inventory_grn_select" ON public.inventory_grn FOR SELECT USING (is_crm_user());
-- No write policy — all writes via receive_grn (SECURITY DEFINER).

-- ── inventory_grn_items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_grn_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.inventory_grn(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES public.inventory_po_items(id),
  quantity_received integer NOT NULL CHECK (quantity_received >= 0)
);
ALTER TABLE public.inventory_grn_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_grn_items_grn_id ON public.inventory_grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_inventory_grn_items_po_item_id ON public.inventory_grn_items(po_item_id);

DROP POLICY IF EXISTS "inventory_grn_items_select" ON public.inventory_grn_items;
CREATE POLICY "inventory_grn_items_select" ON public.inventory_grn_items FOR SELECT USING (is_crm_user());
-- No write policy — all writes via receive_grn (SECURITY DEFINER).

-- ── inventory_supplier_payments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.inventory_suppliers(id),
  amount numeric NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT current_date,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash', 'Cheque', 'Bank Transfer', 'UPI')),
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_supplier_payments_supplier_id ON public.inventory_supplier_payments(supplier_id);

DROP POLICY IF EXISTS "inventory_supplier_payments_select" ON public.inventory_supplier_payments;
CREATE POLICY "inventory_supplier_payments_select" ON public.inventory_supplier_payments FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "inventory_supplier_payments_insert" ON public.inventory_supplier_payments;
CREATE POLICY "inventory_supplier_payments_insert" ON public.inventory_supplier_payments FOR INSERT WITH CHECK (is_crm_user());
DROP POLICY IF EXISTS "inventory_supplier_payments_delete" ON public.inventory_supplier_payments;
CREATE POLICY "inventory_supplier_payments_delete" ON public.inventory_supplier_payments FOR DELETE USING (is_crm_user());
-- No update policy — a payment record is corrected by deleting and re-adding, not editing in place (matches how a real payment ledger should behave).

-- ── create_purchase_order ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_supplier_id uuid,
  p_expected_date date,
  p_notes text,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id     uuid;
  v_po_number integer;
  v_item      jsonb;
  v_row_order integer := 0;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'A purchase order needs at least one line item';
  END IF;

  INSERT INTO inventory_purchase_orders (supplier_id, expected_date, notes, created_by)
  VALUES (p_supplier_id, p_expected_date, p_notes, auth.uid())
  RETURNING id, po_number INTO v_po_id, v_po_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_row_order := v_row_order + 1;
    INSERT INTO inventory_po_items (purchase_order_id, product_id, quantity_ordered, unit_cost, row_order)
    VALUES (
      v_po_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity_ordered')::integer,
      (v_item->>'unit_cost')::numeric,
      v_row_order
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_po_id, 'po_number', v_po_number);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_purchase_order(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, date, text, jsonb) TO authenticated, service_role;

-- ── receive_grn ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_grn(
  p_purchase_order_id uuid,
  p_received_date date,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grn_id        uuid;
  v_grn_number    integer;
  v_item          jsonb;
  v_product_id    uuid;
  v_qty_received  integer;
  v_total_ordered integer;
  v_total_received integer;
  v_fully_received boolean;
  v_any_received   boolean;
  v_new_status    text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A goods-received note needs at least one item';
  END IF;

  INSERT INTO inventory_grn (purchase_order_id, received_date, received_by, notes)
  VALUES (p_purchase_order_id, p_received_date, auth.uid(), p_notes)
  RETURNING id, grn_number INTO v_grn_id, v_grn_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty_received := (v_item->>'quantity_received')::integer;
    IF v_qty_received <= 0 THEN
      CONTINUE; -- skip zero-quantity rows, don't create a pointless GRN item
    END IF;

    INSERT INTO inventory_grn_items (grn_id, po_item_id, quantity_received)
    VALUES (v_grn_id, (v_item->>'po_item_id')::uuid, v_qty_received);

    SELECT product_id INTO v_product_id
    FROM inventory_po_items WHERE id = (v_item->>'po_item_id')::uuid;

    UPDATE products SET stock_quantity = stock_quantity + v_qty_received, updated_at = now()
    WHERE id = v_product_id;
  END LOOP;

  -- Recompute PO status: sum ordered vs. total ever received (across all GRNs for this PO)
  SELECT COALESCE(SUM(poi.quantity_ordered), 0) INTO v_total_ordered
  FROM inventory_po_items poi WHERE poi.purchase_order_id = p_purchase_order_id;

  SELECT COALESCE(SUM(gi.quantity_received), 0) INTO v_total_received
  FROM inventory_grn_items gi
  JOIN inventory_po_items poi ON poi.id = gi.po_item_id
  WHERE poi.purchase_order_id = p_purchase_order_id;

  v_fully_received := v_total_received >= v_total_ordered;
  v_any_received := v_total_received > 0;
  v_new_status := CASE WHEN v_fully_received THEN 'received' WHEN v_any_received THEN 'partially_received' ELSE 'ordered' END;

  UPDATE inventory_purchase_orders SET status = v_new_status, updated_at = now()
  WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('id', v_grn_id, 'grn_number', v_grn_number, 'po_status', v_new_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.receive_grn(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_grn(uuid, date, text, jsonb) TO authenticated, service_role;
