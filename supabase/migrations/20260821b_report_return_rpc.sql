CREATE OR REPLACE FUNCTION public.report_return(
  p_invoice_line_item_id uuid,
  p_quantity integer,
  p_reason_category text,
  p_reason_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT COALESCE(SUM(quantity), 0) INTO v_already_returned
  FROM product_returns WHERE invoice_line_item_id = p_invoice_line_item_id;

  IF v_already_returned + p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'Return quantity exceeds what was invoiced on this line (% already reported, % billed)', v_already_returned, v_line_qty;
  END IF;

  INSERT INTO product_returns (invoice_line_item_id, quantity, reason_category, reason_note, requested_by)
  VALUES (p_invoice_line_item_id, p_quantity, p_reason_category, NULLIF(trim(p_reason_note), ''), auth.uid())
  RETURNING id INTO v_return_id;

  RETURN v_return_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_return(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_return(uuid, integer, text, text) TO authenticated, service_role;
