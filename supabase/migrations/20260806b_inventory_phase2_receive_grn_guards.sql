-- Phase 2 follow-up: harden receive_grn against cross-PO contamination and
-- receiving against a cancelled purchase order. Re-creates receive_grn with
-- the same signature; CREATE OR REPLACE is naturally idempotent, safe to
-- re-run.

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
