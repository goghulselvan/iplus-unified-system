-- Phase 2 final-review fix wave:
--   1. receive_grn's "fully received" check was aggregate-only across the
--      whole PO (sum ordered vs. sum received). An overage on one line item
--      could mask a genuine shortfall on another (e.g. PO has item A ordered
--      10, item B ordered 5; receive A=11, B=4 — total 15 >= 15 flips status
--      to 'received' even though B is still short by 1). Replaced with a
--      per-line check: fully received only if EVERY line item has
--      received-qty >= ordered-qty for that specific item. Also guards the
--      zero-line-item edge case (0 >= 0 would otherwise satisfy "fully
--      received" on the first empty GRN).
--   2. create_purchase_order's empty-line-items guard only caught
--      p_line_items = '[]', not NULL (jsonb_array_length(NULL) is NULL, and
--      `IF NULL THEN` is false in PL/pgSQL, so NULL silently passed through
--      and created a zero-line-item PO). Guard now rejects NULL too.
--   3. New view inventory_supplier_payment_totals: aggregates supplier
--      payment totals server-side so the UI stops fetching every payment row
--      and summing client-side (which would silently under-report past
--      PostgREST's default row cap at scale). Standard Postgres views pass
--      RLS through to the underlying table for the querying role, so no
--      separate RLS policy is needed on the view.
--
-- CREATE OR REPLACE is naturally idempotent, safe to re-run.

-- ── receive_grn: per-line-item completeness check ──────────────────────────
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
  v_po_status     text;
  v_po_item_po_id uuid;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT status INTO v_po_status FROM inventory_purchase_orders WHERE id = p_purchase_order_id;
  IF v_po_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF v_po_status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot receive goods against a cancelled purchase order';
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

    SELECT purchase_order_id, product_id INTO v_po_item_po_id, v_product_id
    FROM inventory_po_items WHERE id = (v_item->>'po_item_id')::uuid;

    IF v_po_item_po_id IS NULL THEN
      RAISE EXCEPTION 'PO item % not found', v_item->>'po_item_id';
    END IF;
    IF v_po_item_po_id != p_purchase_order_id THEN
      RAISE EXCEPTION 'PO item % does not belong to purchase order %', v_item->>'po_item_id', p_purchase_order_id;
    END IF;

    INSERT INTO inventory_grn_items (grn_id, po_item_id, quantity_received)
    VALUES (v_grn_id, (v_item->>'po_item_id')::uuid, v_qty_received);

    UPDATE products SET stock_quantity = stock_quantity + v_qty_received, updated_at = now()
    WHERE id = v_product_id;
  END LOOP;

  -- Recompute PO status. "Fully received" now requires every line item to
  -- individually meet its ordered quantity, not just the aggregate sum.
  SELECT COALESCE(SUM(poi.quantity_ordered), 0) INTO v_total_ordered
  FROM inventory_po_items poi WHERE poi.purchase_order_id = p_purchase_order_id;

  SELECT COALESCE(SUM(gi.quantity_received), 0) INTO v_total_received
  FROM inventory_grn_items gi
  JOIN inventory_po_items poi ON poi.id = gi.po_item_id
  WHERE poi.purchase_order_id = p_purchase_order_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM inventory_po_items poi
    LEFT JOIN (
      SELECT po_item_id, SUM(quantity_received) AS qty
      FROM inventory_grn_items GROUP BY po_item_id
    ) r ON r.po_item_id = poi.id
    WHERE poi.purchase_order_id = p_purchase_order_id
      AND COALESCE(r.qty, 0) < poi.quantity_ordered
  ) AND v_total_ordered > 0
  INTO v_fully_received;

  v_any_received := v_total_received > 0;
  v_new_status := CASE WHEN v_fully_received THEN 'received' WHEN v_any_received THEN 'partially_received' ELSE 'ordered' END;

  UPDATE inventory_purchase_orders SET status = v_new_status, updated_at = now()
  WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('id', v_grn_id, 'grn_number', v_grn_number, 'po_status', v_new_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.receive_grn(uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_grn(uuid, date, text, jsonb) TO authenticated, service_role;

-- ── create_purchase_order: reject NULL line items, not just empty array ────
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

  IF p_line_items IS NULL OR jsonb_array_length(p_line_items) = 0 THEN
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

-- ── inventory_supplier_payment_totals: server-side aggregation ─────────────
CREATE OR REPLACE VIEW public.inventory_supplier_payment_totals AS
SELECT supplier_id, SUM(amount) AS total_paid
FROM public.inventory_supplier_payments
GROUP BY supplier_id;
