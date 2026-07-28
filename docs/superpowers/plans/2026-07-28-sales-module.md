# Sales Module (Products + Invoicing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a third top-level "Sales" module (alongside Prospect Schools and CRM) with a
GST-classified Products catalog and a persistent, numbered invoice ledger for billing CRM and
Prospect schools.

**Architecture:** One Supabase migration adds 4 tables (`products`, `invoices`,
`invoice_line_items`, `invoice_fy_counters`) and 5 SECURITY DEFINER RPCs
(`create_invoice`, `update_invoice`, `void_invoice`, `mark_invoice_paid`,
`search_schools_for_invoice`). The frontend adds a `SalesLayout` (mirrors the existing
`ProspectLayout`), a `ProductsPage` (plain CRUD against the `products` table), an
`InvoiceDialog` (shared create/edit form), an `InvoicesPage` (list + search/filter/sort + row
actions), and a new `invoiceGenerator.ts` PDF utility that mirrors the existing
`receiptGenerator.ts` (pdf-lib, same visual language). Finally, `ModuleSelect.tsx` gets a third
tile and `App.tsx` gets the new routes.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres, RLS, RPC via `supabase-js`),
shadcn/ui components, pdf-lib, react-router-dom. No automated test framework exists in this
repo — every existing feature is verified via direct SQL (`supabase db query --linked`),
`npx tsc --noEmit`, `npm run build`, and manual browser click-through. This plan follows that
same convention rather than introducing a new one.

## Global Constraints

(Copied verbatim from `docs/superpowers/specs/2026-07-28-sales-module-design.md`.)

- Module is named **"Sales"** everywhere — tile label, route prefix `/sales`, file paths
  (`src/pages/Sales/`, `src/components/sales/`) — never "Book Sales".
- GST type auto-detected by buyer's state: `buyer_state` (case-insensitive, trimmed) equal to
  `"Tamil Nadu"` → CGST + SGST split; any other state → IGST. Same total rate, different split.
- `products.gst_rate` must be one of exactly `0, 5, 12, 18, 28` (0% included — printed books,
  HSN 4901, are GST-exempt under Indian law).
- Low-stock badge threshold is a fixed constant: `stock_quantity < 5`. Not configurable.
- `invoices.payment_method` must be one of exactly `'Cash Deposit', 'UPI', 'Online Transfer'`.
- Role access on **Invoices**: Superadmin and Accountant can create, edit, delete, void, and
  mark paid. Manager can only create and mark-as-paid — cannot edit, delete, or void. **Products
  has no role restriction** — all 3 roles (superadmin/manager/accountant) get full CRUD.
- Every actual invoice mutation goes through an RPC (`create_invoice`, `update_invoice`,
  `void_invoice`, `mark_invoice_paid`) — never a raw client `.update()`. Each RPC enforces its
  own role check in its body (SECURITY DEFINER functions bypass table RLS entirely).
- Void requires a non-empty `void_reason`, sets `status='void'`, keeps the row and its invoice
  number in history. Delete hard-removes the row (cascades to line items) — leaves a gap in the
  invoice number sequence, understood to be for genuine mistakes only.
- `invoice_number`/`fy` are assigned once at creation and never change, including on edit.
- Editing an invoice restores the old line items' stock, then re-decrements for the new line
  items — this nets out to the correct delta without needing to track deltas explicitly.
- Insufficient stock never blocks a create/edit — it's allowed, with a toast warning.
- Seller block on the PDF, verbatim: **"iPlus Olympiads"** (bold) / "by Ivar Pro Learn for
  Universal Success Pvt. Ltd." / "115, GST Road, Guduvancheri, Chennai 603 202" /
  "+91 81110 66556". Seller GSTIN: `33AAFCI1730F1Z3`.
- PDF footer, verbatim: *"Computer-generated invoice — no signature required."* and *"Thank you
  for your purchase with iPlus Olympiads!"*
- Existing patterns to follow exactly: `is_crm_user()` for read/create RLS, the
  `receipt_fy_counters`/`generate_receipt_number()` atomic per-FY-counter pattern (this repo's
  Indian financial year: April–March, i.e. months before April belong to the *previous* year's
  FY), `receiptGenerator.ts`'s pdf-lib visual style, and `search_callers_by_name`'s
  CRM+Prospect union-query shape.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260728_sales_module.sql` | All 4 tables, RLS policies, 5 RPCs |
| `src/components/sales/SalesLayout.tsx` | Top nav chrome (Products / Invoices), mirrors `ProspectLayout.tsx` |
| `src/pages/Sales/ProductsPage.tsx` | Products catalog: list, add/edit dialog, delete, active toggle |
| `src/utils/invoiceGenerator.ts` | `generateInvoice()` — pdf-lib PDF builder, mirrors `receiptGenerator.ts` |
| `src/pages/Sales/InvoiceDialog.tsx` | Shared create/edit invoice form (school search, line items, live GST calc) |
| `src/pages/Sales/InvoicesPage.tsx` | Invoice list: search/filter/sort, row actions, wires Dialog + PDF generator |
| `src/pages/ModuleSelect.tsx` (modified) | Add third "Sales" tile |
| `src/App.tsx` (modified) | Add `/sales`, `/sales/products`, `/sales/invoices` routes |

Task order follows dependency order: migration first (nothing depends on frontend code),
`SalesLayout` next (every Sales page wraps in it), then `ProductsPage` (no other Sales file
depends on it), then the PDF utility (standalone, no UI dependency), then `InvoiceDialog`
(standalone form component), then `InvoicesPage` (depends on both), and finally the routing/
`ModuleSelect` wiring that makes the whole thing reachable and clickable end-to-end.

---

### Task 1: Database migration — tables, RLS, and RPCs

**Files:**
- Create: `supabase/migrations/20260728_sales_module.sql`

**Interfaces:**
- Produces tables `products`, `invoices`, `invoice_line_items`, `invoice_fy_counters` and RPCs
  `create_invoice(p_school_id uuid, p_prospect_school_id uuid, p_buyer_name text, p_buyer_address text, p_buyer_state text, p_buyer_gstin text, p_payment_method text, p_line_items jsonb) → jsonb`,
  `update_invoice(p_invoice_id uuid, p_buyer_name text, p_buyer_address text, p_buyer_state text, p_buyer_gstin text, p_payment_method text, p_line_items jsonb) → jsonb`,
  `void_invoice(p_invoice_id uuid, p_reason text) → void`,
  `mark_invoice_paid(p_invoice_id uuid, p_paid boolean) → void`,
  `search_schools_for_invoice(p_query text, p_limit int DEFAULT 6) → TABLE(source text, id uuid, school_name text, ss_no integer, address text, district text, state text)`.
  Every later task consumes these exact names/signatures via `supabase.rpc(...)`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260728_sales_module.sql 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"`

Expected: `{"rows": [], ...}` with no `ERROR` text. (This repo applies migrations this way,
not `supabase db push` — the migration history has ordering gaps that make `db push` want
`--include-all`, which risks re-running older, non-idempotent migrations.)

- [ ] **Step 3: Verify tables and RPCs exist**

Run:
```bash
supabase db query --linked "select table_name from information_schema.tables where table_name in ('products','invoices','invoice_line_items','invoice_fy_counters');" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: all 4 table names returned.

Run:
```bash
supabase db query --linked "select proname from pg_proc where proname in ('create_invoice','update_invoice','void_invoice','mark_invoice_paid','search_schools_for_invoice');" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: all 5 function names returned.

- [ ] **Step 4: Verify `create_invoice` end-to-end with real data**

Find a real prospect school id to test against:
```bash
supabase db query --linked "select id, school_name, state from prospect_schools where state='Tamil Nadu' limit 1;" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Take the returned `id`, then call `create_invoice` directly (replace `<id>` below):
```bash
supabase db query --linked "select create_invoice(null, '<id>'::uuid, 'Test School', 'Test Address', 'Tamil Nadu', null, 'UPI', '[{\"product_id\":null,\"item_name\":\"Test Book\",\"hsn_code\":\"4901\",\"gst_rate\":0,\"quantity\":2,\"unit_price\":100}]'::jsonb);" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: a JSON object with `invoice_number`, `fy`, and an empty `low_stock_warnings` array
(no `product_id` was set, so no stock was touched). Then verify the row landed correctly:
```bash
supabase db query --linked "select invoice_number, fy, buyer_name, subtotal, cgst_amount, sgst_amount, igst_amount, grand_total, status from invoices order by created_at desc limit 1;" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: `subtotal=200`, `cgst_amount=0`, `sgst_amount=0` (0% GST test item), `grand_total=200`,
`status='unpaid'`.

- [ ] **Step 5: Verify the CGST/SGST vs IGST split with a non-Tamil-Nadu buyer**

```bash
supabase db query --linked "select id from prospect_schools where state='Karnataka' limit 1;" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Replace `<id2>` below with the returned id:
```bash
supabase db query --linked "select create_invoice(null, '<id2>'::uuid, 'KA Test School', 'Test Address', 'Karnataka', null, 'Cash Deposit', '[{\"product_id\":null,\"item_name\":\"Taxed Item\",\"hsn_code\":null,\"gst_rate\":18,\"quantity\":1,\"unit_price\":1000}]'::jsonb);" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
supabase db query --linked "select cgst_amount, sgst_amount, igst_amount, grand_total from invoices order by created_at desc limit 1;" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: `cgst_amount=0`, `sgst_amount=0`, `igst_amount=180`, `grand_total=1180`.

- [ ] **Step 6: Verify `void_invoice` requires a reason and the role check works**

```bash
supabase db query --linked "select id from invoices order by created_at desc limit 1;" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Replace `<inv_id>` below with the returned id:
```bash
supabase db query --linked "select void_invoice('<inv_id>'::uuid, '');" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: an error containing `A reason is required to void an invoice` (this direct-SQL call
runs as the `postgres` role, which has no `profiles` row, so it will actually fail on the
*role check* first with `Not authorized` — that's fine, it still proves the function runs and
enforces something; the reason check gets exercised for real once the UI calls it as an
authenticated user in Task 6/7's browser verification).

- [ ] **Step 7: Delete the two test invoices created in Steps 4–5 (cleanup)**

```bash
supabase db query --linked "delete from invoices where buyer_name in ('Test School', 'KA Test School');" 2>&1 | grep -v "^Initialising login role\|^A new version\|^We recommend"
```
Expected: no error. (The `ON DELETE CASCADE` on `invoice_line_items.invoice_id` removes their
line items too.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260728_sales_module.sql
git commit -m "$(cat <<'EOF'
Add Sales module database schema: products, invoices, and 5 RPCs

products (GST-classified rate card + stock), invoices (persistent per-FY
numbered ledger, CGST/SGST-or-IGST auto-detected by buyer state), and
invoice_line_items. RPCs: create_invoice, update_invoice, void_invoice,
mark_invoice_paid (role-checked in-body since SECURITY DEFINER bypasses
table RLS), search_schools_for_invoice (CRM+Prospect union, name or SS No).

Per docs/superpowers/specs/2026-07-28-sales-module-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: SalesLayout — nav chrome

**Files:**
- Create: `src/components/sales/SalesLayout.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`@/hooks/useAuth`) for `profile`/`signOut`.
- Produces: `export default function SalesLayout({ children }: { children: React.ReactNode })`
  — every Sales page (Tasks 3 and 6) wraps its content in `<SalesLayout>...</SalesLayout>`.

- [ ] **Step 1: Write the component**

```tsx
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft, Package, FileText } from 'lucide-react';

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const nav = [
    { label: 'Products', href: '/sales/products', icon: Package },
    { label: 'Invoices', href: '/sales/invoices', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-emerald-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-emerald-200 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-emerald-500" />
              <span className="font-semibold text-sm tracking-wide">Sales</span>
              <div className="flex items-center gap-1">
                {nav.map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
                    to={href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === href
                        ? 'bg-white text-emerald-700'
                        : 'text-emerald-100 hover:bg-emerald-600'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-200 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-emerald-200 hover:text-white hover:bg-emerald-600 h-8 w-8 p-0"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
};

export default SalesLayout;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `SalesLayout.tsx` (it isn't imported by anything yet, so it
compiles standalone — later tasks will exercise it for real).

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/SalesLayout.tsx
git commit -m "$(cat <<'EOF'
Add SalesLayout nav chrome for the Sales module

Mirrors ProspectLayout.tsx exactly (same structure, own color scheme) —
Products / Invoices nav items, Back-to-module-select button.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ProductsPage — catalog CRUD

**Files:**
- Create: `src/pages/Sales/ProductsPage.tsx`

**Interfaces:**
- Consumes: `SalesLayout` (Task 2, default export), `supabase` client
  (`@/integrations/supabase/client`), `useToast` (`@/hooks/use-toast`), the `products` table
  columns from Task 1 (`id, name, hsn_code, gst_rate, unit_price, stock_quantity, is_active`).
- Produces: `export default function ProductsPage()` — consumed by `App.tsx` in Task 7, and its
  `products` table rows are read by `InvoiceDialog` in Task 5 (`is_active = true` products only).

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Product = {
  id: string;
  name: string;
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
  stock_quantity: number;
  is_active: boolean;
};

const GST_RATES = [0, 5, 12, 18, 28];
const LOW_STOCK_THRESHOLD = 5;
const emptyForm = { name: '', hsn_code: '', gst_rate: '18', unit_price: '', stock_quantity: '' };

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products' as any)
      .select('id, name, hsn_code, gst_rate, unit_price, stock_quantity, is_active')
      .order('name');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setProducts((data || []) as unknown as Product[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      hsn_code: p.hsn_code ?? '',
      gst_rate: String(p.gst_rate),
      unit_price: String(p.unit_price),
      stock_quantity: String(p.stock_quantity),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      hsn_code: form.hsn_code.trim() || null,
      gst_rate: Number(form.gst_rate),
      unit_price: Number(form.unit_price) || 0,
      stock_quantity: Number(form.stock_quantity) || 0,
    };
    const { error } = editing
      ? await supabase.from('products' as any).update(payload).eq('id', editing.id)
      : await supabase.from('products' as any).insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editing ? 'Product updated' : 'Product added' });
    setDialogOpen(false);
    loadProducts();
  };

  const toggleActive = async (p: Product) => {
    const { error } = await supabase.from('products' as any).update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    loadProducts();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('products' as any).delete().eq('id', deleteTarget.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setDeleteTarget(null); return; }
    toast({ title: 'Product deleted' });
    setDeleteTarget(null);
    loadProducts();
  };

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Products</h1>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Product</Button>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>HSN/SAC</TableHead>
                <TableHead>GST Rate</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : products.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>
              ) : (
                products.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.hsn_code || '—'}</TableCell>
                    <TableCell>{p.gst_rate}%</TableCell>
                    <TableCell>₹{p.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      {p.stock_quantity}
                      {p.stock_quantity < LOW_STOCK_THRESHOLD && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Low stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(p)}>
                        <Badge variant={p.is_active ? 'default' : 'outline'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="p-hsn">HSN/SAC Code</Label>
              <Input id="p-hsn" value={form.hsn_code} onChange={e => setForm(f => ({ ...f, hsn_code: e.target.value }))} />
            </div>
            <div>
              <Label>GST Rate</Label>
              <Select value={form.gst_rate} onValueChange={v => setForm(f => ({ ...f, gst_rate: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-price">Unit Price (₹)</Label>
              <Input id="p-price" type="number" min="0" step="0.01" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="p-stock">{editing ? 'Stock Quantity' : 'Initial Stock Quantity'}</Label>
              <Input id="p-stock" type="number" min="0" value={form.stock_quantity} onChange={e => setForm(f => ({ ...f, stock_quantity: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesLayout>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `ProductsPage.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Sales/ProductsPage.tsx
git commit -m "$(cat <<'EOF'
Add ProductsPage: GST-classified catalog with stock tracking

Full CRUD against the products table (Task 1) — add/edit dialog (name,
HSN/SAC, GST rate 0/5/12/18/28%, unit price, stock quantity), active
toggle, delete with confirmation, low-stock badge at <5 units. No role
restriction — all 3 CRM roles have full access, per spec decision #5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: invoiceGenerator.ts — PDF builder

**Files:**
- Create: `src/utils/invoiceGenerator.ts`

**Interfaces:**
- Consumes: `numberToWords` (`./numberToWords`), `@/assets/iplus-logo.png`,
  `@/assets/receipt-watermark.png` (same assets `receiptGenerator.ts` already uses).
- Produces: `export interface InvoiceLineItemData { itemName: string; hsnCode: string | null; gstRate: number; quantity: number; unitPrice: number; lineTotal: number; }`,
  `export interface InvoiceData { invoiceNumber: number; fy: number; invoiceDate: Date; buyerName: string; buyerSsNo?: number | null; buyerAddress?: string | null; buyerState: string; buyerGstin?: string | null; paymentMethod: string; status: string; lineItems: InvoiceLineItemData[]; subtotal: number; cgstAmount: number; sgstAmount: number; igstAmount: number; grandTotal: number; }`,
  `export async function generateInvoice(data: InvoiceData): Promise<Blob>` — consumed by
  `InvoicesPage.tsx` in Task 6 for the "Download PDF" and "auto-download after
  save" actions.

- [ ] **Step 1: Write the utility**

```ts
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import { numberToWords } from './numberToWords';
import iplusLogoUrl from '@/assets/iplus-logo.png';
import receiptWatermarkUrl from '@/assets/receipt-watermark.png';

const COMPANY_GSTIN = '33AAFCI1730F1Z3';

export interface InvoiceLineItemData {
  itemName: string;
  hsnCode: string | null;
  gstRate: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceData {
  invoiceNumber: number;
  fy: number;
  invoiceDate: Date;
  buyerName: string;
  buyerSsNo?: number | null;
  buyerAddress?: string | null;
  buyerState: string;
  buyerGstin?: string | null;
  paymentMethod: string;
  status: string; // 'unpaid' | 'paid' | 'void'
  lineItems: InvoiceLineItemData[];
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
}

const IVORY = rgb(254 / 255, 248 / 255, 237 / 255);
const INDIGO = { r: 79 / 255, g: 70 / 255, b: 229 / 255 };
const VIOLET = { r: 124 / 255, g: 58 / 255, b: 237 / 255 };
const TEXT_DARK = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.51);
const CARD_BORDER = rgb(0.87, 0.85, 0.95);
const ROW_SHADE = rgb(0.97, 0.97, 0.99);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function splitTextIntoLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(testLine, fontSize) <= maxWidth) currentLine = testLine;
    else { if (currentLine) lines.push(currentLine); currentLine = word; }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [text];
}

const fmtINR = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateInvoice(data: InvoiceData): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const W = 595.28, H = 841.89; // A4 portrait
  const page = pdfDoc.addPage([W, H]);
  const MARGIN = 40;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const logoBytes = await fetch(iplusLogoUrl).then(r => r.arrayBuffer());
  const logoImg = await pdfDoc.embedPng(logoBytes);
  const wmBytes = await fetch(receiptWatermarkUrl).then(r => r.arrayBuffer());
  const wmImg = await pdfDoc.embedPng(wmBytes);

  const isTn = data.buyerState.trim().toLowerCase() === 'tamil nadu';
  const invoiceNo = `INV/${data.fy}-${data.fy + 1}/${data.invoiceNumber}`;
  const dateStr = format(data.invoiceDate, 'dd-MMM-yyyy');

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: IVORY });

  const wmH = 260, wmW = wmH * (wmImg.width / wmImg.height);
  page.drawImage(wmImg, { x: (W - wmW) / 2, y: (H - wmH) / 2, width: wmW, height: wmH, opacity: 0.05 });

  const barH = 7, STRIPS = 80, stripW = W / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const t = i / (STRIPS - 1);
    const c = rgb(lerp(INDIGO.r, VIOLET.r, t), lerp(INDIGO.g, VIOLET.g, t), lerp(INDIGO.b, VIOLET.b, t));
    page.drawRectangle({ x: i * stripW, y: H - barH, width: stripW + 0.5, height: barH, color: c });
  }

  const logoH = 38, logoW = logoH * (logoImg.width / logoImg.height);
  const logoY = H - barH - 14 - logoH;
  page.drawImage(logoImg, { x: MARGIN, y: logoY, width: logoW, height: logoH });

  const gstinText = `GSTIN: ${COMPANY_GSTIN}`;
  const gstinW = font.widthOfTextAtSize(gstinText, 9);
  page.drawText(gstinText, { x: W - MARGIN - gstinW, y: H - 30, size: 9, font, color: MUTED });
  const titleText = 'TAX INVOICE';
  const titleW = fontBold.widthOfTextAtSize(titleText, 16);
  page.drawText(titleText, { x: W - MARGIN - titleW, y: H - 48, size: 16, font: fontBold, color: TEXT_DARK });

  let cy = logoY - 16;
  const sellerLines: { t: string; size: number; f: PDFFont }[] = [
    { t: 'iPlus Olympiads', size: 12, f: fontBold },
    { t: 'by Ivar Pro Learn for Universal Success Pvt. Ltd.', size: 9, f: font },
    { t: '115, GST Road, Guduvancheri, Chennai 603 202', size: 8.5, f: font },
    { t: '+91 81110 66556', size: 8.5, f: font },
  ];
  for (const line of sellerLines) {
    const w = line.f.widthOfTextAtSize(line.t, line.size);
    page.drawText(line.t, { x: (W - w) / 2, y: cy, size: line.size, font: line.f, color: line.f === fontBold ? TEXT_DARK : MUTED });
    cy -= line.size + 4;
  }

  const dividerY = cy - 8;
  page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: W - MARGIN, y: dividerY }, thickness: 0.75, color: CARD_BORDER });

  const metaLabelY = dividerY - 18, metaValueY = dividerY - 32;
  const colWMeta = (W - 2 * MARGIN) / 4;
  const meta = [
    { label: 'INVOICE NO.', value: invoiceNo },
    { label: 'DATE', value: dateStr },
    { label: 'PAYMENT METHOD', value: data.paymentMethod },
    { label: 'STATUS', value: data.status.toUpperCase() },
  ];
  meta.forEach((m, i) => {
    const x = MARGIN + i * colWMeta;
    page.drawText(m.label, { x, y: metaLabelY, size: 7.5, font: fontBold, color: MUTED });
    page.drawText(String(m.value), { x, y: metaValueY, size: 10.5, font: fontBold, color: TEXT_DARK });
  });

  const divider2Y = metaValueY - 14;
  page.drawLine({ start: { x: MARGIN, y: divider2Y }, end: { x: W - MARGIN, y: divider2Y }, thickness: 0.75, color: CARD_BORDER });

  let by = divider2Y - 18;
  page.drawText('BILL TO', { x: MARGIN, y: by, size: 7.5, font: fontBold, color: MUTED });
  by -= 16;
  const nameLines = splitTextIntoLines(data.buyerName, fontBold, 13, W - 2 * MARGIN);
  for (const line of nameLines) {
    page.drawText(line, { x: MARGIN, y: by, size: 13, font: fontBold, color: TEXT_DARK });
    by -= 16;
  }
  if (data.buyerSsNo != null) {
    page.drawText(`SS No: ${data.buyerSsNo}`, { x: MARGIN, y: by, size: 9, font, color: MUTED });
    by -= 13;
  }
  if (data.buyerAddress) {
    for (const line of splitTextIntoLines(data.buyerAddress, font, 9, W - 2 * MARGIN)) {
      page.drawText(line, { x: MARGIN, y: by, size: 9, font, color: MUTED });
      by -= 12;
    }
  }
  page.drawText(data.buyerState, { x: MARGIN, y: by, size: 9, font, color: MUTED });
  by -= 12;
  if (data.buyerGstin) {
    page.drawText(`GSTIN: ${data.buyerGstin}`, { x: MARGIN, y: by, size: 9, font, color: MUTED });
    by -= 12;
  }

  const tableTop = by - 14;
  const cols = [
    { key: 'sno', label: 'S.No', w: 32 },
    { key: 'item', label: 'Item', w: 190 },
    { key: 'hsn', label: 'HSN/SAC', w: 70 },
    { key: 'qty', label: 'Qty', w: 40 },
    { key: 'price', label: 'Unit Price', w: 80 },
    { key: 'total', label: 'Total', w: 103 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const colX: number[] = [];
  { let x = MARGIN; for (const c of cols) { colX.push(x); x += c.w; } }

  let rowFontSize = 9;
  const rowH = 18;
  const maxTableH = tableTop - 170;
  if (data.lineItems.length * rowH > maxTableH) {
    rowFontSize = Math.max(6.5, 9 * (maxTableH / (data.lineItems.length * rowH)));
  }
  const actualRowH = Math.max(14, rowFontSize + 8);

  page.drawRectangle({ x: MARGIN, y: tableTop - 16, width: tableW, height: 16, color: rgb(0.94, 0.93, 0.98) });
  cols.forEach((c, i) => {
    page.drawText(c.label, { x: colX[i] + 4, y: tableTop - 12, size: 8, font: fontBold, color: TEXT_DARK });
  });

  let rowY = tableTop - 16;
  data.lineItems.forEach((item, idx) => {
    rowY -= actualRowH;
    if (idx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: rowY, width: tableW, height: actualRowH, color: ROW_SHADE });
    }
    const textY = rowY + actualRowH / 2 - rowFontSize / 2.6;
    page.drawText(String(idx + 1), { x: colX[0] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    const itemLines = splitTextIntoLines(item.itemName, font, rowFontSize, cols[1].w - 8);
    page.drawText(itemLines[0], { x: colX[1] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(item.hsnCode || '—', { x: colX[2] + 4, y: textY, size: rowFontSize, font, color: MUTED });
    page.drawText(String(item.quantity), { x: colX[3] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(fmtINR(item.unitPrice), { x: colX[4] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(fmtINR(item.lineTotal), { x: colX[5] + 4, y: textY, size: rowFontSize, font: fontBold, color: TEXT_DARK });
  });

  page.drawLine({ start: { x: MARGIN, y: rowY }, end: { x: MARGIN + tableW, y: rowY }, thickness: 0.75, color: CARD_BORDER });

  let sy = rowY - 20;
  const summaryX = MARGIN + tableW - 200;
  const drawSummaryLine = (label: string, value: string, bold = false) => {
    const f = bold ? fontBold : font;
    const fs = bold ? 11 : 9.5;
    page.drawText(label, { x: summaryX, y: sy, size: fs, font: f, color: bold ? TEXT_DARK : MUTED });
    const vw = f.widthOfTextAtSize(value, fs);
    page.drawText(value, { x: MARGIN + tableW - vw, y: sy, size: fs, font: f, color: TEXT_DARK });
    sy -= bold ? 18 : 14;
  };
  drawSummaryLine('Subtotal', fmtINR(data.subtotal));
  if (isTn) {
    drawSummaryLine('CGST', fmtINR(data.cgstAmount));
    drawSummaryLine('SGST', fmtINR(data.sgstAmount));
  } else {
    drawSummaryLine('IGST', fmtINR(data.igstAmount));
  }
  page.drawLine({ start: { x: summaryX, y: sy + 6 }, end: { x: MARGIN + tableW, y: sy + 6 }, thickness: 0.75, color: CARD_BORDER });
  sy -= 6;
  drawSummaryLine('Grand Total', fmtINR(data.grandTotal), true);

  sy -= 6;
  for (const line of splitTextIntoLines(numberToWords(data.grandTotal), fontItalic, 8.5, W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: sy, size: 8.5, font: fontItalic, color: MUTED });
    sy -= 11;
  }

  const currentDateTime = format(new Date(), 'dd-MMM-yyyy hh:mm a');
  page.drawText(`Computer-generated invoice — no signature required. Generated on ${currentDateTime}`,
    { x: MARGIN, y: 24, size: 7, font: fontItalic, color: MUTED });
  const thanksText = 'Thank you for your purchase with iPlus Olympiads!';
  const thanksW = fontItalic.widthOfTextAtSize(thanksText, 8);
  page.drawText(thanksText, { x: W - MARGIN - thanksW, y: 24, size: 8, font: fontItalic, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `invoiceGenerator.ts`.

Note: this function uses `fetch()` to load Vite-processed asset URLs, so it can't be exercised
by a bare Node script the way the earlier ad-hoc label scripts were (that's how
`receiptGenerator.ts` already works in this codebase too — it's only ever run in the browser).
Real visual verification happens in Task 6, once `InvoicesPage.tsx` can actually call it from a
"Download PDF" click and the resulting PDF can be opened.

- [ ] **Step 3: Commit**

```bash
git add src/utils/invoiceGenerator.ts
git commit -m "$(cat <<'EOF'
Add invoiceGenerator.ts — tax invoice PDF builder

Mirrors receiptGenerator.ts's exact visual language (pdf-lib, same fonts/
colors/watermark/logo) on an A4 page: seller block, Bill To, line items
table (auto-shrinks font if the cart has many rows), CGST+SGST-or-IGST tax
summary, amount in words, and the required "computer-generated, no
signature" + "thank you" footer text.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: InvoiceDialog — shared create/edit form

**Files:**
- Create: `src/pages/Sales/InvoiceDialog.tsx`

**Interfaces:**
- Consumes: `search_schools_for_invoice` RPC (Task 1), `products` table (Task 3's data shape),
  `create_invoice`/`update_invoice` RPCs (Task 1).
- Produces: `export type LineItemForm = { product_id: string | null; item_name: string; hsn_code: string; gst_rate: number; quantity: number; unit_price: number; }`,
  `export type EditingInvoice = { id: string; school_id: string | null; prospect_school_id: string | null; buyer_name: string; buyer_ss_no: number | null; buyer_address: string; buyer_state: string; buyer_gstin: string; payment_method: string; line_items: LineItemForm[]; }`,
  `export default function InvoiceDialog({ open, onOpenChange, editingInvoice, onSaved }: Props)`
  where `Props = { open: boolean; onOpenChange: (open: boolean) => void; editingInvoice: EditingInvoice | null; onSaved: (result: { id: string; invoice_number?: number; fy?: number; low_stock_warnings?: any[] }) => void; }`
  — consumed by `InvoicesPage.tsx` in Task 6.

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type SchoolHit = {
  source: 'crm' | 'prospect';
  id: string;
  school_name: string;
  ss_no: number | null;
  address: string | null;
  district: string | null;
  state: string | null;
};

type Product = {
  id: string;
  name: string;
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
};

export type LineItemForm = {
  product_id: string | null;
  item_name: string;
  hsn_code: string;
  gst_rate: number;
  quantity: number;
  unit_price: number;
};

export type EditingInvoice = {
  id: string;
  school_id: string | null;
  prospect_school_id: string | null;
  buyer_name: string;
  buyer_ss_no: number | null;
  buyer_address: string;
  buyer_state: string;
  buyer_gstin: string;
  payment_method: string;
  line_items: LineItemForm[];
};

const PAYMENT_METHODS = ['Cash Deposit', 'UPI', 'Online Transfer'];

function emptyLine(): LineItemForm {
  return { product_id: null, item_name: '', hsn_code: '', gst_rate: 18, quantity: 1, unit_price: 0 };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingInvoice: EditingInvoice | null;
  onSaved: (result: { id: string; invoice_number?: number; fy?: number; low_stock_warnings?: any[] }) => void;
}

export default function InvoiceDialog({ open, onOpenChange, editingInvoice, onSaved }: Props) {
  const { toast } = useToast();
  const isEdit = !!editingInvoice;

  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolHits, setSchoolHits] = useState<SchoolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<SchoolHit | null>(null);

  const [buyerName, setBuyerName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerState, setBuyerState] = useState('');
  const [buyerGstin, setBuyerGstin] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash Deposit');

  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from('products' as any).select('id, name, hsn_code, gst_rate, unit_price').eq('is_active', true).order('name')
      .then(({ data }) => setProducts((data || []) as unknown as Product[]));

    if (editingInvoice) {
      setSelectedSchool({
        source: editingInvoice.school_id ? 'crm' : 'prospect',
        id: (editingInvoice.school_id || editingInvoice.prospect_school_id)!,
        school_name: editingInvoice.buyer_name,
        ss_no: editingInvoice.buyer_ss_no,
        address: editingInvoice.buyer_address,
        district: null,
        state: editingInvoice.buyer_state,
      });
      setBuyerName(editingInvoice.buyer_name);
      setBuyerAddress(editingInvoice.buyer_address);
      setBuyerState(editingInvoice.buyer_state);
      setBuyerGstin(editingInvoice.buyer_gstin);
      setPaymentMethod(editingInvoice.payment_method);
      setLineItems(editingInvoice.line_items.length ? editingInvoice.line_items : [emptyLine()]);
    } else {
      setSelectedSchool(null);
      setBuyerName(''); setBuyerAddress(''); setBuyerState(''); setBuyerGstin('');
      setPaymentMethod('Cash Deposit');
      setLineItems([emptyLine()]);
    }
    setSchoolQuery(''); setSchoolHits([]);
  }, [open, editingInvoice]);

  const searchSchools = async (q: string) => {
    setSchoolQuery(q);
    if (q.trim().length < 2) { setSchoolHits([]); return; }
    setSearching(true);
    const { data } = await supabase.rpc('search_schools_for_invoice' as any, { p_query: q.trim(), p_limit: 6 });
    setSchoolHits((data as SchoolHit[]) ?? []);
    setSearching(false);
  };

  const pickSchool = (hit: SchoolHit) => {
    setSelectedSchool(hit);
    setBuyerName(hit.school_name);
    setBuyerAddress(hit.address || '');
    setBuyerState(hit.state || '');
    setSchoolQuery(''); setSchoolHits([]);
  };

  const addRow = () => setLineItems(prev => [...prev, emptyLine()]);
  const removeRow = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<LineItemForm>) => {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  const pickProduct = (idx: number, productId: string) => {
    const p = products.find(p => p.id === productId);
    if (!p) return;
    updateRow(idx, { product_id: p.id, item_name: p.name, hsn_code: p.hsn_code || '', gst_rate: p.gst_rate, unit_price: p.unit_price });
  };

  const isTn = buyerState.trim().toLowerCase() === 'tamil nadu';
  const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const totalTax = lineItems.reduce((s, l) => s + (l.quantity * l.unit_price * l.gst_rate) / 100, 0);
  const cgst = isTn ? totalTax / 2 : 0;
  const sgst = isTn ? totalTax / 2 : 0;
  const igst = isTn ? 0 : totalTax;
  const grandTotal = subtotal + totalTax;

  const canSave = !!(selectedSchool || isEdit) && buyerName.trim() && buyerState.trim() && paymentMethod
    && lineItems.length > 0 && lineItems.every(l => l.item_name.trim() && l.quantity > 0);

  const handleSave = async () => {
    if (!canSave) { toast({ title: 'Fill in all required fields', variant: 'destructive' }); return; }
    setSaving(true);
    const payloadLineItems = lineItems.map(l => ({
      product_id: l.product_id, item_name: l.item_name.trim(), hsn_code: l.hsn_code || null,
      gst_rate: l.gst_rate, quantity: l.quantity, unit_price: l.unit_price,
    }));

    if (isEdit) {
      const { data, error } = await supabase.rpc('update_invoice' as any, {
        p_invoice_id: editingInvoice!.id,
        p_buyer_name: buyerName.trim(), p_buyer_address: buyerAddress.trim() || null,
        p_buyer_state: buyerState.trim(), p_buyer_gstin: buyerGstin.trim() || null,
        p_payment_method: paymentMethod, p_line_items: payloadLineItems,
      });
      setSaving(false);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Invoice updated' });
      onSaved({ id: editingInvoice!.id, low_stock_warnings: (data as any)?.low_stock_warnings });
    } else {
      const { data, error } = await supabase.rpc('create_invoice' as any, {
        p_school_id: selectedSchool!.source === 'crm' ? selectedSchool!.id : null,
        p_prospect_school_id: selectedSchool!.source === 'prospect' ? selectedSchool!.id : null,
        p_buyer_name: buyerName.trim(), p_buyer_address: buyerAddress.trim() || null,
        p_buyer_state: buyerState.trim(), p_buyer_gstin: buyerGstin.trim() || null,
        p_payment_method: paymentMethod, p_line_items: payloadLineItems,
      });
      setSaving(false);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Invoice created' });
      const r = data as any;
      onSaved({ id: r.id, invoice_number: r.invoice_number, fy: r.fy, low_stock_warnings: r.low_stock_warnings });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Invoice' : 'New Invoice'}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div>
              <Label>School (name or SS No)</Label>
              {selectedSchool ? (
                <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-gray-50">
                  <span className="text-sm font-medium">{selectedSchool.school_name}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSchool(null); setBuyerName(''); setBuyerAddress(''); setBuyerState(''); }}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search school name or SS No…" value={schoolQuery}
                    onChange={e => searchSchools(e.target.value)} />
                  {schoolHits.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
                      {schoolHits.map(h => (
                        <button key={`${h.source}-${h.id}`} onClick={() => pickSchool(h)}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{h.school_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {h.ss_no != null && `SS #${h.ss_no} · `}{[h.district, h.state].filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">{h.source === 'crm' ? 'CRM' : 'Prospect'}</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                  {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Buyer Name</Label>
              <Input value={buyerName} onChange={e => setBuyerName(e.target.value)} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={buyerState} onChange={e => setBuyerState(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <Input value={buyerAddress} onChange={e => setBuyerAddress(e.target.value)} />
            </div>
            <div>
              <Label>GSTIN (optional)</Label>
              <Input value={buyerGstin} onChange={e => setBuyerGstin(e.target.value)} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-2 w-8">#</th>
                  <th className="text-left px-2 py-2">Item</th>
                  <th className="text-left px-2 py-2 w-20">GST%</th>
                  <th className="text-left px-2 py-2 w-20">Price</th>
                  <th className="text-left px-2 py-2 w-16">Qty</th>
                  <th className="text-right px-2 py-2 w-24">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1.5">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Select value={l.product_id ?? '__custom__'} onValueChange={v => v === '__custom__' ? updateRow(idx, { product_id: null }) : pickProduct(idx, v)}>
                        <SelectTrigger className="h-8 mb-1"><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom__">Custom item…</SelectItem>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input className="h-8" placeholder="Item name" value={l.item_name} onChange={e => updateRow(idx, { item_name: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" value={l.gst_rate} onChange={e => updateRow(idx, { gst_rate: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="0" step="0.01" value={l.unit_price} onChange={e => updateRow(idx, { unit_price: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="1" value={l.quantity} onChange={e => updateRow(idx, { quantity: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">₹{(l.quantity * l.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1.5">
                      {lineItems.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeRow(idx)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addRow} className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 border-t flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Row
            </button>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              {isTn ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>₹{cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>₹{sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>₹{igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              )}
              <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Generate Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `InvoiceDialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Sales/InvoiceDialog.tsx
git commit -m "$(cat <<'EOF'
Add InvoiceDialog: shared create/edit invoice form

School search (CRM + Prospect, name or SS No) via search_schools_for_invoice,
buyer fields prefilled on pick, Payment Method dropdown, dynamic line-item
table (pick a Product or type a custom item), live Subtotal/CGST+SGST-or-
IGST/Grand Total. Calls create_invoice in create mode, update_invoice in
edit mode (school not reassignable once created, per spec decision #9).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: InvoicesPage — list, search/filter/sort, row actions

**Files:**
- Create: `src/pages/Sales/InvoicesPage.tsx`

**Interfaces:**
- Consumes: `SalesLayout` (Task 2), `InvoiceDialog` + `EditingInvoice` type (Task 5),
  `generateInvoice`/`InvoiceData` (Task 4), `useAuth()` for `profile.role`, the `invoices`/
  `invoice_line_items` tables (Task 1), RPCs `mark_invoice_paid`/`void_invoice` (Task 1).
- Produces: `export default function InvoicesPage()` — consumed by `App.tsx` in Task 7.

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Download, Pencil, Ban, Trash2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import InvoiceDialog, { EditingInvoice } from './InvoiceDialog';
import { generateInvoice } from '@/utils/invoiceGenerator';

type InvoiceRow = {
  id: string;
  invoice_number: number;
  fy: number;
  buyer_name: string;
  school_id: string | null;
  prospect_school_id: string | null;
  payment_method: string;
  status: 'unpaid' | 'paid' | 'void';
  grand_total: number;
  created_at: string;
};

const PAGE_SIZE = 200;

export default function InvoicesPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<EditingInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);

  const loadInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices' as any)
      .select('id, invoice_number, fy, buyer_name, school_id, prospect_school_id, payment_method, status, grand_total, created_at')
      .order('fy', { ascending: false })
      .order('invoice_number', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setLoading(false); return; }
    setInvoices((data || []) as unknown as InvoiceRow[]);
    setLoading(false);
  };

  useEffect(() => { loadInvoices(); }, []);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => String(r.invoice_number).includes(q) || r.buyer_name.toLowerCase().includes(q));
    }
    const sorted = [...rows];
    switch (sortBy) {
      case 'oldest': sorted.sort((a, b) => (a.fy - b.fy) || (a.invoice_number - b.invoice_number)); break;
      case 'amount_desc': sorted.sort((a, b) => b.grand_total - a.grand_total); break;
      case 'amount_asc': sorted.sort((a, b) => a.grand_total - b.grand_total); break;
      default: sorted.sort((a, b) => (b.fy - a.fy) || (b.invoice_number - a.invoice_number));
    }
    return sorted;
  }, [invoices, statusFilter, search, sortBy]);

  const openNew = () => { setEditingInvoice(null); setDialogOpen(true); };

  const openEdit = async (row: InvoiceRow) => {
    const { data: inv, error: e1 } = await supabase.from('invoices' as any).select('*').eq('id', row.id).single();
    const { data: items, error: e2 } = await supabase.from('invoice_line_items' as any).select('*').eq('invoice_id', row.id).order('row_order');
    if (e1 || e2 || !inv) { toast({ title: 'Error loading invoice', variant: 'destructive' }); return; }
    const invAny = inv as any;
    setEditingInvoice({
      id: invAny.id,
      school_id: invAny.school_id,
      prospect_school_id: invAny.prospect_school_id,
      buyer_name: invAny.buyer_name,
      buyer_ss_no: null,
      buyer_address: invAny.buyer_address || '',
      buyer_state: invAny.buyer_state,
      buyer_gstin: invAny.buyer_gstin || '',
      payment_method: invAny.payment_method,
      line_items: ((items || []) as any[]).map(li => ({
        product_id: li.product_id, item_name: li.item_name, hsn_code: li.hsn_code || '',
        gst_rate: li.gst_rate, quantity: li.quantity, unit_price: li.unit_price,
      })),
    });
    setDialogOpen(true);
  };

  const handleDownload = async (id: string) => {
    const { data: inv } = await supabase.from('invoices' as any).select('*').eq('id', id).single();
    const { data: items } = await supabase.from('invoice_line_items' as any).select('*').eq('invoice_id', id).order('row_order');
    if (!inv) { toast({ title: 'Error loading invoice', variant: 'destructive' }); return; }
    const invAny = inv as any;
    const blob = await generateInvoice({
      invoiceNumber: invAny.invoice_number,
      fy: invAny.fy,
      invoiceDate: new Date(invAny.created_at),
      buyerName: invAny.buyer_name,
      buyerSsNo: null,
      buyerAddress: invAny.buyer_address,
      buyerState: invAny.buyer_state,
      buyerGstin: invAny.buyer_gstin,
      paymentMethod: invAny.payment_method,
      status: invAny.status,
      lineItems: ((items || []) as any[]).map(li => ({
        itemName: li.item_name, hsnCode: li.hsn_code, gstRate: li.gst_rate,
        quantity: li.quantity, unitPrice: li.unit_price, lineTotal: li.line_total,
      })),
      subtotal: invAny.subtotal, cgstAmount: invAny.cgst_amount, sgstAmount: invAny.sgst_amount,
      igstAmount: invAny.igst_amount, grandTotal: invAny.grand_total,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_INV-${invAny.fy}-${invAny.fy + 1}-${invAny.invoice_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaved = async (result: { id: string; low_stock_warnings?: any[] }) => {
    await loadInvoices();
    if (result.low_stock_warnings?.length) {
      toast({ title: 'Low stock warning', description: `${result.low_stock_warnings.length} product(s) now below zero stock.`, variant: 'destructive' });
    }
    handleDownload(result.id);
  };

  const togglePaid = async (row: InvoiceRow) => {
    const { error } = await supabase.rpc('mark_invoice_paid' as any, { p_invoice_id: row.id, p_paid: row.status !== 'paid' });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    loadInvoices();
  };

  const handleVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    const { error } = await supabase.rpc('void_invoice' as any, { p_invoice_id: voidTarget.id, p_reason: voidReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invoice voided' });
    setVoidTarget(null); setVoidReason('');
    loadInvoices();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('invoices' as any).delete().eq('id', deleteTarget.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setDeleteTarget(null); return; }
    toast({ title: 'Invoice deleted' });
    setDeleteTarget(null);
    loadInvoices();
  };

  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge className="bg-emerald-100 text-emerald-700">Paid</Badge>;
    if (s === 'void') return <Badge className="bg-gray-200 text-gray-600">Void</Badge>;
    return <Badge className="bg-amber-100 text-amber-700">Unpaid</Badge>;
  };

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Invoices</h1>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New Invoice</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search invoice no. or buyer name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="amount_desc">Amount High→Low</SelectItem>
              <SelectItem value="amount_asc">Amount Low→High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Grand Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
              ) : (
                filtered.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">INV/{row.fy}-{row.fy + 1}/{row.invoice_number}</TableCell>
                    <TableCell>{new Date(row.created_at).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>{row.buyer_name}</TableCell>
                    <TableCell>{row.payment_method}</TableCell>
                    <TableCell>₹{row.grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(row.id)}><Download className="h-3.5 w-3.5" /></Button>
                      {row.status !== 'void' && (
                        <Button variant="ghost" size="sm" onClick={() => togglePaid(row)}>
                          {row.status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
                        </Button>
                      )}
                      {canManage && row.status !== 'void' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row)}><Ban className="h-3.5 w-3.5 text-amber-600" /></Button>
                        </>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <InvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} editingInvoice={editingInvoice} onSaved={handleSaved} />

      <Dialog open={!!voidTarget} onOpenChange={open => { if (!open) { setVoidTarget(null); setVoidReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Void Invoice INV/{voidTarget?.fy}-{(voidTarget?.fy ?? 0) + 1}/{voidTarget?.invoice_number}</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for voiding (required)" value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>Cancel</Button>
            <Button onClick={handleVoid} disabled={!voidReason.trim()} className="bg-amber-600 hover:bg-amber-700">Void Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice INV/{deleteTarget?.fy}-{(deleteTarget?.fy ?? 0) + 1}/{deleteTarget?.invoice_number}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the invoice and will leave a gap in the invoice number sequence. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesLayout>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `InvoicesPage.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Sales/InvoicesPage.tsx
git commit -m "$(cat <<'EOF'
Add InvoicesPage: list with search/filter/sort + role-gated row actions

Search (invoice no./buyer name), status filter, sort dropdown defaulting
to newest-first. Download PDF and Mark Paid/Unpaid available to every
role; Edit/Void/Delete only render for superadmin/accountant (matched by
the RPC/RLS-level checks from Task 1, not just hidden here). Auto-
downloads the PDF right after a create or edit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Module registration — ModuleSelect tile + routes

**Files:**
- Modify: `src/pages/ModuleSelect.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ProductsPage` (Task 3), `InvoicesPage` (Task 6), existing `ProtectedRoute`
  component.
- Produces: the module becomes reachable — `/sales` (redirects to `/sales/invoices`),
  `/sales/products`, `/sales/invoices` — and a third tile on `/module-select`.

- [ ] **Step 1: Add the third tile to `ModuleSelect.tsx`**

In `src/pages/ModuleSelect.tsx`, change the import line:

```tsx
import { LogOut, Users, Building2, ArrowRight, MapPin, ShoppingCart } from 'lucide-react';
```

Then change the grid `div` from `grid-cols-1 md:grid-cols-2` to `md:grid-cols-3`, and add a
third tile after the CRM tile (before the closing `</div>` of the grid):

```tsx
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
```

```tsx
          {/* Sales tile */}
          <button
            onClick={() => navigate('/sales')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <ShoppingCart className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">Sales</h2>
            <p className="text-sm text-white/80">Products · Invoicing · GST Billing</p>
          </button>
```

The full file after these two edits should read:

```tsx
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, Users, Building2, ArrowRight, MapPin, ShoppingCart } from 'lucide-react';

const ModuleSelect = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-primary text-primary-foreground px-6 py-4 flex items-center justify-between">
        <div className="font-bold text-lg">iPlus Olympiads</div>
        <div className="flex items-center gap-4">
          <span className="text-sm opacity-80">{profile?.username}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-primary-foreground hover:bg-primary/80"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {profile?.username}</h1>
        <p className="text-gray-500 mb-12">Select a module to continue</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
          {/* Prospect Schools tile */}
          <button
            onClick={() => navigate('/prospect')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-fuchsia-600 via-pink-500 to-orange-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <MapPin className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">Prospect Schools</h2>
            <p className="text-sm text-white/80">Outreach · Campaigns · Email Blasts</p>
          </button>

          {/* CRM tile */}
          <button
            onClick={() => navigate('/dashboard')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-blue-600 via-cyan-500 to-emerald-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <Building2 className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">CRM</h2>
            <p className="text-sm text-white/80">Registrations · Payments · Results · Workflow</p>
          </button>

          {/* Sales tile */}
          <button
            onClick={() => navigate('/sales')}
            className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-400"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
                <ShoppingCart className="h-7 w-7 text-white" />
              </div>
              <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
            <h2 className="text-xl font-bold mb-1">Sales</h2>
            <p className="text-sm text-white/80">Products · Invoicing · GST Billing</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModuleSelect;
```

- [ ] **Step 2: Add routes to `App.tsx`**

Add these two imports near the other page imports (right after the `ProspectVoiceCampaigns`
import line):

```tsx
import ProductsPage from "./pages/Sales/ProductsPage";
import InvoicesPage from "./pages/Sales/InvoicesPage";
```

Add these three routes right after the existing `/prospect/campaigns/:id` route line and
before `<Route path="*" element={<NotFound />} />`:

```tsx
         <Route path="/sales" element={<ProtectedRoute><Navigate to="/sales/invoices" replace /></ProtectedRoute>} />
         <Route path="/sales/products" element={<ProtectedRoute><ProductsPage /></ProtectedRoute>} />
         <Route path="/sales/invoices" element={<ProtectedRoute><InvoicesPage /></ProtectedRoute>} />
```

(`Navigate` is already imported at the top of `App.tsx` from `react-router-dom` — it's used
by the existing `NotFound`/redirect patterns in this file, so no new import is needed for it.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built in ...` with no errors. (Ignore the pre-existing "chunks are larger than
500 kB" warning — unrelated to this change.)

- [ ] **Step 5: Revert the local `dist/` build artifacts**

This repo tracks `dist/` in git; running a local build for verification modifies it. Revert so
the commit only contains source changes:

```bash
git checkout -- dist/ 2>&1
git clean -fd dist/ 2>&1
git status --short dist/
```
Expected: no output from the last command (clean).

- [ ] **Step 6: Manual browser verification**

Run: `npm run dev` (if not already running), then in a browser:
1. Go to `/module-select` — confirm a third **"Sales"** tile appears (emerald gradient,
   shopping-cart icon), alongside Prospect Schools and CRM.
2. Click it — lands on `/sales/invoices` (empty list, since nothing's been created via the
   UI yet).
3. Click the **Products** nav item — lands on `/sales/products`. Click **Add Product**, fill
   in a name, pick a GST rate, set a unit price and stock quantity, save — confirm the row
   appears in the table with the correct GST% and a "Low stock" badge if stock < 5.
4. Go back to **Invoices**, click **New Invoice**. Search for a real school (by name or SS No)
   — confirm results show both CRM and Prospect matches with the correct badge. Pick one —
   confirm Buyer Name/Address/State prefill. Pick the product just created from the line-item
   dropdown — confirm price/GST rate autofill. Set a quantity, confirm the Subtotal/CGST-SGST-
   or-IGST/Grand Total update live (test once with a Tamil Nadu school and once with a non-Tamil
   Nadu school, to see both tax splits). Set Payment Method, click **Generate Invoice**.
5. Confirm a PDF downloads automatically, and opening it shows: the iPlus Olympiads/Ivar Pro
   Learn seller block, the correct invoice number (`INV/{fy}-{fy+1}/1` for the very first one),
   the line item, the correct tax split, and the exact footer text ("Computer-generated invoice
   — no signature required." / "Thank you for your purchase with iPlus Olympiads!").
6. Back on the Invoices list, confirm the new row appears at the top (newest-first default),
   with the correct Grand Total and an "Unpaid" badge. Click **Mark Paid** — badge changes to
   "Paid". Click **Download** — re-downloads the same PDF.
7. If logged in as superadmin or accountant: click **Edit** — confirm the dialog reopens
   prefilled with the same buyer/line-item data, school search is disabled/locked. Change the
   quantity, save — confirm the Grand Total and the product's stock quantity both update
   correctly (check the Products page: stock should reflect only the *new* quantity, not double-
   decremented). Click the Void icon, confirm it requires a non-empty reason, then void it —
   confirm the row shows a "Void" badge and Edit/Void buttons disappear for that row. Create one
   more invoice and Delete it — confirm a warning about the number-sequence gap, then confirm
   the row disappears from the list entirely.
8. If logged in as manager: confirm Edit/Void/Delete buttons are absent for every row, but
   New Invoice, Download, and Mark Paid/Unpaid are all still available.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ModuleSelect.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
Wire up the Sales module: third ModuleSelect tile + routes

/sales redirects to /sales/invoices, /sales/products and /sales/invoices
route to the new pages. This is the final integration step — the whole
Sales module (Products catalog + GST invoicing) is now reachable end-to-
end from Module Select.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Push and deploy**

```bash
git push unified main
git push origin main
```

Then confirm the FTP deploy succeeds:
```bash
gh run list --repo goghulselvan/iplus-unified-system --limit 1
```
Take the run ID from the output and:
```bash
gh run watch <run_id> --repo goghulselvan/iplus-unified-system --exit-status
```
Expected: `✓ main Build & Deploy to FTP` with all steps green.

---

## Self-Review

**Spec coverage:** every numbered decision in
`docs/superpowers/specs/2026-07-28-sales-module-design.md` maps to a task —
module naming/tile (Task 7), GST auto-detect (Tasks 1, 4, 5), Products rate-card+stock (Tasks 1,
3), persistent numbered ledger (Task 1), role-based access incl. Manager's mark-paid carve-out
(Tasks 1, 6), warn-not-block stock incl. edit-delta (Task 1), Payment Method field (Tasks 1, 5,
6), Void≠Delete (Tasks 1, 6), Edit (Tasks 1, 5, 6), search/filter/sort defaulting newest-first
(Task 6), PDF seller block/footer text verbatim (Task 4).

**Placeholder scan:** no TBD/TODO/"add error handling"-style steps — every step has complete,
real code or an exact command with expected output.

**Type consistency:** `LineItemForm`/`EditingInvoice` (Task 5) are the exact shapes Task 6
imports and constructs; `InvoiceData`/`InvoiceLineItemData` (Task 4) are the exact shapes Task 6
builds before calling `generateInvoice`; the RPC parameter names (`p_school_id`,
`p_prospect_school_id`, `p_buyer_name`, etc. — Task 1) match exactly what Tasks 5/6 pass to
`supabase.rpc(...)`.
