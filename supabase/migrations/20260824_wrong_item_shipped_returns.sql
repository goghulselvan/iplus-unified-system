-- report_return/confirm_return_received (2026-08-21) assumed the returned
-- product always matches the invoiced product. True for damaged-in-transit
-- and school-never-wanted-it returns; false for a genuine fulfillment
-- mix-up where a different physical book shipped than what's on the
-- invoice. This lets staff record which product actually shipped, so stock
-- corrects on the real product on both ends of the return, while the
-- credit note continues to track the invoiced product's value throughout —
-- money always follows the invoice, only stock routing changes.

ALTER TABLE public.product_returns
  ADD COLUMN actual_product_id uuid REFERENCES public.products(id);

-- report_return is widening from 4 params to 5 (new trailing optional
-- p_actual_product_id). CREATE OR REPLACE FUNCTION only replaces a function
-- with an IDENTICAL argument type list; a different arg count creates a
-- separate, coexisting overload instead. Verified against this project's
-- live DB: leaving the old 4-arg report_return(uuid,integer,text,text) in
-- place alongside the new 5-arg-with-default version makes every existing
-- call site (report_return called with exactly 4 args, either positional or
-- PostgREST's named-argument form) raise "function report_return(...) is not
-- unique" — the opposite of this migration's stated contract that existing
-- 4-arg call sites are unaffected. Drop the old signature first so only one
-- report_return exists, matching the precedent already used in this
-- codebase for the same situation (see 20260815c_drop_old_payment_rpc_signatures.sql).
DROP FUNCTION IF EXISTS public.report_return(uuid, integer, text, text);

CREATE OR REPLACE FUNCTION public.report_return(
  p_invoice_line_item_id uuid,
  p_quantity integer,
  p_reason_category text,
  p_reason_note text,
  p_actual_product_id uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_line_qty integer;
  v_school_id uuid;
  v_invoice_status text;
  v_already_returned integer;
  v_return_id uuid;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  IF p_reason_category NOT IN ('wrong_item_shipped', 'wrong_item_ordered_by_staff', 'damaged_in_transit', 'other') THEN
    RAISE EXCEPTION 'Invalid reason category';
  END IF;

  IF p_actual_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_actual_product_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Selected product is not a valid active product';
  END IF;

  SELECT ili.invoice_id, ili.quantity INTO v_invoice_id, v_line_qty
  FROM invoice_line_items ili WHERE ili.id = p_invoice_line_item_id;
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Invoice line item not found';
  END IF;

  SELECT i.school_id, i.status INTO v_school_id, v_invoice_status
  FROM invoices i WHERE i.id = v_invoice_id;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Returns are only supported for school-billed invoices';
  END IF;
  IF v_invoice_status = 'void' THEN
    RAISE EXCEPTION 'Cannot report a return against a voided invoice';
  END IF;

  -- Advisory lock to serialize concurrent over-return checks on same line item
  -- Prevents TOCTOU race where two concurrent calls could both pass the quantity check
  PERFORM pg_advisory_xact_lock(hashtext(p_invoice_line_item_id::text));

  SELECT COALESCE(SUM(quantity), 0) INTO v_already_returned
  FROM product_returns WHERE invoice_line_item_id = p_invoice_line_item_id;

  IF v_already_returned + p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'Return quantity exceeds what was invoiced on this line (% already reported, % billed)', v_already_returned, v_line_qty;
  END IF;

  INSERT INTO product_returns (invoice_line_item_id, quantity, reason_category, reason_note, requested_by, actual_product_id)
  VALUES (p_invoice_line_item_id, p_quantity, p_reason_category, NULLIF(trim(p_reason_note), ''), auth.uid(), p_actual_product_id)
  RETURNING id INTO v_return_id;

  -- Correcting a retroactive stock error, not anticipating a future one — the
  -- wrong product already physically left the building at original dispatch;
  -- the system just never recorded it because the invoice pointed elsewhere.
  -- Allowed to go negative, same precedent as create_invoice's own stock
  -- decrement — the physical shortfall is real regardless of the counter.
  IF p_actual_product_id IS NOT NULL THEN
    UPDATE products SET stock_quantity = stock_quantity - p_quantity, updated_at = now()
    WHERE id = p_actual_product_id;
  END IF;

  RETURN v_return_id;
END;
$function$;

-- A newly created function object (this is a new object, not a same-signature
-- replace — see DROP above) picks up this project's schema-level default
-- privileges, which grant EXECUTE to anon by default (verified empirically).
-- The original 20260821c migration deliberately revoked anon/PUBLIC access on
-- report_return; re-apply that same posture on the new 5-arg signature so it
-- isn't silently widened.
REVOKE EXECUTE ON FUNCTION public.report_return(uuid, integer, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_return(uuid, integer, text, text, uuid) TO authenticated, service_role;

-- confirm_return_received keeps its existing (uuid, text) signature, so
-- CREATE OR REPLACE here is a true same-signature replace — Postgres
-- preserves the function's existing ownership/grants automatically, no
-- REVOKE/GRANT needed.
CREATE OR REPLACE FUNCTION public.confirm_return_received(p_return_id uuid, p_condition text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
  v_actual_product_id uuid;
  v_restock_product_id uuid;
  v_unit_price numeric;
  v_invoice_id uuid;
  v_school_id uuid;
  v_credit_amount numeric;
  v_fy smallint;
  v_next integer;
  v_credit_note_id uuid;
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_condition NOT IN ('resellable', 'damaged') THEN
    RAISE EXCEPTION 'Condition must be resellable or damaged';
  END IF;

  -- Advisory lock to serialize concurrent status checks on same return id
  -- Prevents TOCTOU race where two concurrent calls could both read 'requested' status,
  -- both pass the check, and both mint credit notes / restore stock
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id, actual_product_id
  INTO v_status, v_quantity, v_line_item_id, v_actual_product_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'This return has already been received';
  END IF;

  SELECT product_id, unit_price, invoice_id INTO v_product_id, v_unit_price, v_invoice_id
  FROM invoice_line_items WHERE id = v_line_item_id;

  SELECT school_id INTO v_school_id FROM invoices WHERE id = v_invoice_id;

  -- Restock whichever product actually needs it: the one that really shipped
  -- (if recorded) or the invoiced one (the base feature's original,
  -- unchanged behavior when no mismatch was recorded).
  v_restock_product_id := COALESCE(v_actual_product_id, v_product_id);

  IF p_condition = 'resellable' THEN
    IF v_restock_product_id IS NULL THEN
      RAISE EXCEPTION 'This line has no catalog product — it cannot be restocked; record it as damaged instead';
    END IF;
    UPDATE products SET stock_quantity = stock_quantity + v_quantity
    WHERE id = v_restock_product_id;
  END IF;

  -- Credit amount always tracks the INVOICED product's price — unchanged
  -- regardless of which physical SKU shipped. Money follows the invoice;
  -- only stock routing follows the actual product.
  v_credit_amount := v_unit_price * v_quantity;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO credit_note_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO credit_notes (credit_note_number, fy, school_id, source_return_id, amount, created_by)
  VALUES (v_next, v_fy, v_school_id, p_return_id, v_credit_amount, auth.uid())
  RETURNING id INTO v_credit_note_id;

  UPDATE product_returns
  SET status = 'received', condition_on_receipt = p_condition, received_by = auth.uid(), received_at = now()
  WHERE id = p_return_id;

  RETURN v_credit_note_id;
END;
$function$;
