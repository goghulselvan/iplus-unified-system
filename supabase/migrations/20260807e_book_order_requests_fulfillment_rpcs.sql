-- ── approve_order_items ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_order_items(p_order_id uuid, p_item_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_status text;
  v_school_id uuid;
  v_order_payment_mode text;
  v_school_name text;
  v_school_address text;
  v_school_state text;
  v_invoice_payment_method text;
  v_line_items jsonb;
  v_item record;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_count integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status, school_id, payment_mode INTO v_payment_status, v_school_id, v_order_payment_mode
  FROM product_orders WHERE id = p_order_id;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_payment_status != 'confirmed' THEN
    RAISE EXCEPTION 'Order payment must be confirmed before invoicing';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE id = ANY(p_item_ids) AND order_id = p_order_id AND line_status = 'pending';
  IF v_count != array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected items are not pending on this order';
  END IF;

  -- Re-check live stock — catches the rare race/count-error case; create_invoice's own
  -- stock decrement is warn-don't-block by design (matches every other invoice), so this
  -- is a courtesy early-exit, not the last line of defense.
  FOR v_item IN
    SELECT oi.id, oi.quantity, p.stock_quantity
    FROM product_order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.id = ANY(p_item_ids)
  LOOP
    IF v_item.quantity > v_item.stock_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for one of the selected items — reject it instead';
    END IF;
  END LOOP;

  SELECT school_name, school_address, state INTO v_school_name, v_school_address, v_school_state
  FROM schools WHERE id = v_school_id;

  v_invoice_payment_method := CASE v_order_payment_mode
    WHEN 'UPI' THEN 'UPI'
    WHEN 'NEFT' THEN 'Online Transfer'
    ELSE 'Online Transfer'
  END;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'item_name', p.name,
    'hsn_code', p.hsn_code,
    'gst_rate', p.gst_rate,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price
  ))
  INTO v_line_items
  FROM product_order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.id = ANY(p_item_ids);

  v_invoice_result := create_invoice(
    v_school_id, NULL, v_school_name, v_school_address, v_school_state, NULL,
    v_invoice_payment_method, v_line_items
  );
  v_invoice_id := (v_invoice_result->>'id')::uuid;

  UPDATE product_order_items
  SET invoice_id = v_invoice_id, line_status = 'invoiced_unpaid'
  WHERE id = ANY(p_item_ids);

  RETURN v_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_order_items(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_order_items(uuid, uuid[]) TO authenticated, service_role;

-- ── reject_order_items ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_order_items(p_order_id uuid, p_item_ids uuid[], p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE id = ANY(p_item_ids) AND order_id = p_order_id AND line_status = 'pending';
  IF v_count != array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected items are not pending on this order';
  END IF;

  UPDATE product_order_items
  SET line_status = 'rejected',
      rejected_reason = trim(p_reason),
      rejected_by = auth.uid(),
      rejected_at = now()
  WHERE id = ANY(p_item_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_order_items(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_order_items(uuid, uuid[], text) TO authenticated, service_role;

-- ── mark_invoice_dispatched ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_dispatched(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT status INTO v_status FROM invoices WHERE id = p_invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot dispatch an invoice that is not paid';
  END IF;

  UPDATE invoices SET dispatched_at = now() WHERE id = p_invoice_id AND dispatched_at IS NULL;

  UPDATE product_order_items
  SET line_status = 'dispatched'
  WHERE invoice_id = p_invoice_id AND line_status = 'paid';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_invoice_dispatched(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_dispatched(uuid) TO authenticated, service_role;

-- ── trigger: keep product_order_items.line_status in sync with invoices.status ─
CREATE OR REPLACE FUNCTION public.sync_order_items_on_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE product_order_items
    SET line_status = 'paid'
    WHERE invoice_id = NEW.id AND line_status = 'invoiced_unpaid';
  ELSIF NEW.status = 'void' THEN
    -- Restore stock for released items first (undo create_invoice's earlier
    -- decrement for exactly these lines) BEFORE releasing them, so the
    -- void -> re-approve recovery path below doesn't silently double-decrement
    -- stock for books that never physically moved.
    UPDATE products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM product_order_items oi
    WHERE oi.invoice_id = NEW.id
      AND oi.line_status IN ('invoiced_unpaid', 'paid')
      AND p.id = oi.product_id;

    -- A voided invoice can never become paid again (mark_invoice_paid refuses void
    -- invoices) or be dispatched, so items left pointing at it would be stuck forever.
    -- Release them back to 'pending' with no invoice, so they re-enter the normal
    -- approve_order_items queue on a fresh invoice. Dispatched items are untouched —
    -- the books already physically left, voiding the paperwork after the fact
    -- doesn't undo that.
    UPDATE product_order_items
    SET line_status = 'pending', invoice_id = NULL
    WHERE invoice_id = NEW.id AND line_status IN ('invoiced_unpaid', 'paid');
  ELSIF NEW.status = 'unpaid' AND OLD.status = 'paid' THEN
    -- Invoice un-marked as paid (not voided) — revert any linked item that hadn't
    -- dispatched yet. Items already 'dispatched' stay dispatched.
    UPDATE product_order_items
    SET line_status = 'invoiced_unpaid'
    WHERE invoice_id = NEW.id AND line_status = 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_items_on_invoice_paid ON public.invoices;
CREATE TRIGGER trg_sync_order_items_on_invoice_paid
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_items_on_invoice_paid();
