-- Fix a same-order concurrent-partial-approval double-spend path left open by
-- 20260821f: approve_order_items read credit_applied_to_invoice once at
-- function entry (alongside the rest of the product_orders lookup) and gated
-- the entire credit block — including the advisory-lock acquisition itself —
-- on that stale value.
--
-- approve_order_items supports partial approval: a single order's items can
-- be approved across multiple separate calls with different p_item_ids
-- subsets. If two calls approving different item subsets of the SAME order
-- run concurrently, both can read credit_applied_to_invoice = false before
-- either commits, both enter the block, and both serialize on the same
-- advisory-lock key (hashtext(credit_note_id) — identical for both calls,
-- since it's the same order's credit note). The balance re-check only catches
-- this if the note's remaining balance can't cover the amount twice; if it
-- can, the second call also passes and inserts a second
-- credit_note_applications row for the same order, over-applying the credit.
--
-- Fix: acquire the lock first, before trusting any flag, then re-read
-- credit_applied_to_invoice fresh from product_orders once the lock is held,
-- and gate the balance-check/INSERT on that fresh read. Whichever call
-- acquires the lock second now sees the freshly-committed
-- credit_applied_to_invoice = true from the first call and correctly skips.
--
-- approve_order_items' signature is unchanged, so a plain CREATE OR REPLACE
-- is sufficient here (no DROP FUNCTION needed — that was only required in
-- 20260821f because create_manual_product_order's parameter list changed).

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
  v_credit_note_id uuid;
  v_credit_amount numeric;
  v_credit_already_applied boolean;
  v_credit_balance numeric;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status, school_id, payment_mode, applied_credit_note_id, applied_credit_amount, credit_applied_to_invoice
  INTO v_payment_status, v_school_id, v_order_payment_mode, v_credit_note_id, v_credit_amount, v_credit_already_applied
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

  -- Payment was already verified before approval was possible — mark the
  -- invoice paid immediately. Runs after the UPDATE above so the trigger's
  -- cascade (invoiced_unpaid -> paid) finds the items it needs to flip.
  -- (Restored from the live function — supabase/migrations/20260810_approve_order_items_auto_mark_paid.sql
  -- added this after this plan's original reference copy of approve_order_items was read;
  -- omitting it here would have silently regressed a real, already-shipped fix.)
  PERFORM mark_invoice_paid(v_invoice_id, true);

  IF v_credit_note_id IS NOT NULL THEN
    -- Acquire the lock BEFORE trusting the credit_applied_to_invoice flag at
    -- all — not just before the balance re-check. Two calls approving
    -- different item subsets of the SAME order both reference this order's
    -- credit note, so they serialize on the same advisory-lock key here.
    -- Whichever call gets the lock second must not act on the stale
    -- v_credit_already_applied it captured at function entry (before either
    -- call had committed anything) — it has to look again, now that it's
    -- guaranteed to see the first call's committed write.
    PERFORM pg_advisory_xact_lock(hashtext(v_credit_note_id::text));

    SELECT credit_applied_to_invoice INTO v_credit_already_applied
    FROM product_orders WHERE id = p_order_id;

    IF NOT v_credit_already_applied THEN
      -- Re-validate the credit note's balance here, at the moment it's actually
      -- spent — not just at order-creation time. Two different manual orders can
      -- both reference the same credit note before either is approved (each
      -- independently passed create_manual_product_order's balance check, since
      -- neither had actually consumed anything yet); without this re-check and
      -- lock, both could be approved and both would successfully record a
      -- credit_note_applications row, double-spending the credit. The lock
      -- serializes concurrent approve_order_items calls that reference the same
      -- credit note; the balance re-check catches the case where an earlier,
      -- already-committed order legitimately used up the balance first.
      SELECT remaining_balance INTO v_credit_balance
      FROM credit_notes_with_balance WHERE id = v_credit_note_id;

      IF v_credit_balance < v_credit_amount THEN
        RAISE EXCEPTION 'Credit note no longer has sufficient balance (% remaining, % required) — another order may have already used it; remove or reduce the applied credit on this order and retry',
          v_credit_balance, v_credit_amount;
      END IF;

      INSERT INTO credit_note_applications (credit_note_id, application_type, amount, applied_to_invoice_id, recorded_by)
      VALUES (v_credit_note_id, 'invoice', v_credit_amount, v_invoice_id, auth.uid());

      UPDATE product_orders SET credit_applied_to_invoice = true WHERE id = p_order_id;
    END IF;
  END IF;

  RETURN v_invoice_id;
END;
$$;
