-- Sales module: Products catalog (GST-classified, stock-tracked) + persistent,
-- numbered invoice ledger for billing CRM/Prospect schools. Mirrors the existing
-- payment-receipt pattern (receipt_fy_counters/generate_receipt_number) for
-- invoice numbering. See docs/superpowers/specs/2026-07-28-sales-module-design.md.

-- ── products ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hsn_code text,
  gst_rate numeric NOT NULL CHECK (gst_rate IN (0, 5, 12, 18, 28)),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  stock_quantity integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products FOR INSERT WITH CHECK (is_crm_user());
DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products FOR UPDATE USING (is_crm_user());
DROP POLICY IF EXISTS "products_delete" ON public.products;
CREATE POLICY "products_delete" ON public.products FOR DELETE USING (is_crm_user());

-- ── invoices ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number integer,
  fy smallint,
  school_id uuid REFERENCES public.schools(id),
  prospect_school_id uuid REFERENCES public.prospect_schools(id),
  buyer_name text NOT NULL,
  buyer_address text,
  buyer_state text NOT NULL,
  buyer_gstin text,
  subtotal numeric NOT NULL DEFAULT 0,
  cgst_amount numeric NOT NULL DEFAULT 0,
  sgst_amount numeric NOT NULL DEFAULT 0,
  igst_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL CHECK (payment_method IN ('Cash Deposit', 'UPI', 'Online Transfer')),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  paid_at timestamptz,
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_one_buyer_check CHECK (
    (school_id IS NOT NULL AND prospect_school_id IS NULL) OR
    (school_id IS NULL AND prospect_school_id IS NOT NULL)
  )
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT WITH CHECK (is_crm_user());
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant'))
);
DROP POLICY IF EXISTS "invoices_delete" ON public.invoices;
CREATE POLICY "invoices_delete" ON public.invoices FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant'))
);

-- ── invoice_line_items ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  item_name text NOT NULL,
  hsn_code text,
  gst_rate numeric NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_total numeric NOT NULL,
  row_order integer NOT NULL
);
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_line_items_select" ON public.invoice_line_items;
CREATE POLICY "invoice_line_items_select" ON public.invoice_line_items FOR SELECT USING (is_crm_user());
-- No insert/update/delete policy — all writes go through create_invoice/update_invoice
-- (SECURITY DEFINER), which bypass RLS entirely. This locks out any direct client write.

-- ── invoice_fy_counters ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_fy_counters ENABLE ROW LEVEL SECURITY;

-- ── create_invoice ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_invoice(
  p_school_id uuid,
  p_prospect_school_id uuid,
  p_buyer_name text,
  p_buyer_address text,
  p_buyer_state text,
  p_buyer_gstin text,
  p_payment_method text,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ist            timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_fy             smallint;
  v_next           integer;
  v_invoice_id     uuid;
  v_subtotal       numeric := 0;
  v_cgst           numeric := 0;
  v_sgst           numeric := 0;
  v_igst           numeric := 0;
  v_grand_total    numeric;
  v_is_tn          boolean;
  v_item           jsonb;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_row_order      integer := 0;
  v_low_stock      jsonb := '[]'::jsonb;
  v_current_stock  integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF (p_school_id IS NULL) = (p_prospect_school_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_school_id / p_prospect_school_id must be set';
  END IF;

  v_is_tn := (trim(lower(p_buyer_state)) = 'tamil nadu');

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO invoice_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_line_total := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer;
    v_line_tax   := v_line_total * (v_item->>'gst_rate')::numeric / 100;
    v_subtotal   := v_subtotal + v_line_total;
    IF v_is_tn THEN
      v_cgst := v_cgst + v_line_tax / 2;
      v_sgst := v_sgst + v_line_tax / 2;
    ELSE
      v_igst := v_igst + v_line_tax;
    END IF;
  END LOOP;
  v_grand_total := v_subtotal + v_cgst + v_sgst + v_igst;

  INSERT INTO invoices (
    invoice_number, fy, school_id, prospect_school_id, buyer_name, buyer_address,
    buyer_state, buyer_gstin, subtotal, cgst_amount, sgst_amount, igst_amount,
    grand_total, payment_method, created_by
  ) VALUES (
    v_next, v_fy, p_school_id, p_prospect_school_id, p_buyer_name, p_buyer_address,
    p_buyer_state, p_buyer_gstin, v_subtotal, v_cgst, v_sgst, v_igst,
    v_grand_total, p_payment_method, auth.uid()
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_row_order := v_row_order + 1;
    v_line_total := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer;

    INSERT INTO invoice_line_items (
      invoice_id, product_id, item_name, hsn_code, gst_rate, quantity, unit_price, line_total, row_order
    ) VALUES (
      v_invoice_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      v_item->>'item_name',
      v_item->>'hsn_code',
      (v_item->>'gst_rate')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      v_line_total,
      v_row_order
    );

    IF NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
      UPDATE products
      SET stock_quantity = stock_quantity - (v_item->>'quantity')::integer,
          updated_at = now()
      WHERE id = (v_item->>'product_id')::uuid
      RETURNING stock_quantity INTO v_current_stock;

      IF v_current_stock < 0 THEN
        v_low_stock := v_low_stock || jsonb_build_object(
          'product_id', v_item->>'product_id',
          'item_name', v_item->>'item_name',
          'stock_quantity', v_current_stock
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_next,
    'fy', v_fy,
    'low_stock_warnings', v_low_stock
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_invoice(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid, uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- ── update_invoice ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_invoice(
  p_invoice_id uuid,
  p_buyer_name text,
  p_buyer_address text,
  p_buyer_state text,
  p_buyer_gstin text,
  p_payment_method text,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role           text;
  v_status         text;
  v_is_tn          boolean;
  v_subtotal       numeric := 0;
  v_cgst           numeric := 0;
  v_sgst           numeric := 0;
  v_igst           numeric := 0;
  v_grand_total    numeric;
  v_item           jsonb;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_row_order      integer := 0;
  v_low_stock      jsonb := '[]'::jsonb;
  v_current_stock  integer;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('superadmin', 'accountant') THEN
    RAISE EXCEPTION 'Not authorized — only superadmin/accountant can edit an invoice';
  END IF;

  SELECT status INTO v_status FROM invoices WHERE id = p_invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_status = 'void' THEN
    RAISE EXCEPTION 'Cannot edit a voided invoice';
  END IF;

  v_is_tn := (trim(lower(p_buyer_state)) = 'tamil nadu');

  -- Restore stock for the OLD line items before replacing them, so the net
  -- effect below is a correct delta rather than a blind double-decrement.
  FOR v_item IN
    SELECT jsonb_build_object('product_id', product_id, 'quantity', quantity)
    FROM invoice_line_items WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL
  LOOP
    UPDATE products SET stock_quantity = stock_quantity + (v_item->>'quantity')::integer, updated_at = now()
    WHERE id = (v_item->>'product_id')::uuid;
  END LOOP;

  DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_line_total := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer;
    v_line_tax   := v_line_total * (v_item->>'gst_rate')::numeric / 100;
    v_subtotal   := v_subtotal + v_line_total;
    IF v_is_tn THEN
      v_cgst := v_cgst + v_line_tax / 2;
      v_sgst := v_sgst + v_line_tax / 2;
    ELSE
      v_igst := v_igst + v_line_tax;
    END IF;
  END LOOP;
  v_grand_total := v_subtotal + v_cgst + v_sgst + v_igst;

  UPDATE invoices SET
    buyer_name = p_buyer_name, buyer_address = p_buyer_address, buyer_state = p_buyer_state,
    buyer_gstin = p_buyer_gstin, payment_method = p_payment_method,
    subtotal = v_subtotal, cgst_amount = v_cgst, sgst_amount = v_sgst, igst_amount = v_igst,
    grand_total = v_grand_total
  WHERE id = p_invoice_id;

  v_row_order := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_row_order := v_row_order + 1;
    v_line_total := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer;

    INSERT INTO invoice_line_items (
      invoice_id, product_id, item_name, hsn_code, gst_rate, quantity, unit_price, line_total, row_order
    ) VALUES (
      p_invoice_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      v_item->>'item_name', v_item->>'hsn_code', (v_item->>'gst_rate')::numeric,
      (v_item->>'quantity')::integer, (v_item->>'unit_price')::numeric, v_line_total, v_row_order
    );

    IF NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
      UPDATE products
      SET stock_quantity = stock_quantity - (v_item->>'quantity')::integer, updated_at = now()
      WHERE id = (v_item->>'product_id')::uuid
      RETURNING stock_quantity INTO v_current_stock;

      IF v_current_stock < 0 THEN
        v_low_stock := v_low_stock || jsonb_build_object(
          'product_id', v_item->>'product_id', 'item_name', v_item->>'item_name', 'stock_quantity', v_current_stock
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('id', p_invoice_id, 'low_stock_warnings', v_low_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_invoice(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_invoice(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- ── void_invoice ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('superadmin', 'accountant') THEN
    RAISE EXCEPTION 'Not authorized — only superadmin/accountant can void an invoice';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void an invoice';
  END IF;

  UPDATE invoices
  SET status = 'void', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated, service_role;

-- ── mark_invoice_paid ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_invoice_paid(p_invoice_id uuid, p_paid boolean)
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
  IF v_status = 'void' THEN
    RAISE EXCEPTION 'Cannot mark a voided invoice as paid';
  END IF;

  UPDATE invoices
  SET status = CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END,
      paid_at = CASE WHEN p_paid THEN now() ELSE NULL END
  WHERE id = p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_invoice_paid(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paid(uuid, boolean) TO authenticated, service_role;

-- ── search_schools_for_invoice ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_schools_for_invoice(p_query text, p_limit int DEFAULT 6)
RETURNS TABLE (
  source text, id uuid, school_name text, ss_no integer,
  address text, district text, state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT 'crm', s.id, s.school_name, s.ss_no, s.school_address, s.district, s.state
    FROM schools s
    WHERE s.school_name ILIKE '%' || p_query || '%'
       OR (p_query ~ '^\d+$' AND s.ss_no = p_query::integer)
    ORDER BY (s.ss_no::text = p_query) DESC, s.school_name
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'prospect', p.id, p.school_name, p.ss_no, p.address, p.district, p.state
    FROM prospect_schools p
    WHERE p.school_name ILIKE '%' || p_query || '%'
       OR (p_query ~ '^\d+$' AND p.ss_no = p_query::integer)
    ORDER BY (p.ss_no::text = p_query) DESC, p.school_name
    LIMIT p_limit
  )
$$;

REVOKE EXECUTE ON FUNCTION public.search_schools_for_invoice(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_schools_for_invoice(text, int) TO authenticated, service_role;
