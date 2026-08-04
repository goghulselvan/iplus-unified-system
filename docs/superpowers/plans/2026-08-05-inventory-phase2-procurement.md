# Inventory Module — Phase 2: Procurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add supplier management, purchase orders, goods-received reconciliation, and supplier payment tracking to the Sales module — the second of 6 phases in the inventory module rebuild (see `docs/superpowers/specs/2026-08-04-inventory-module-rebuild-design.md`).

**Architecture:** 6 new tables (suppliers, purchase orders, PO line items, GRN, GRN line items, supplier payments) plus 2 SECURITY DEFINER RPCs for the two operations with real side-effects (`create_purchase_order` — atomic PO + line items; `receive_grn` — atomic GRN + line items + stock increment + PO status recompute), mirroring the exact pattern already proven by `create_invoice`/`invoice_line_items` in `20260728_sales_module.sql`. Everything else (suppliers CRUD, supplier payments) uses direct client calls, matching how Products itself works — no RPC needed when there's no multi-table side-effect to make atomic.

**Tech Stack:** React + TypeScript + Vite, shadcn/ui, Supabase (Postgres + supabase-js direct calls + RPCs), Supabase CLI (`db query --linked --file`) for migrations.

## Global Constraints

- Never use `supabase db push` — apply migrations with `supabase db query --linked --file <path>`, register the version in `supabase_migrations.schema_migrations`.
- RLS: `is_crm_user()` for read/general write, matching every table in this CRM except Invoices' manager restriction (not applicable here — no equivalent restriction was asked for on procurement).
- No test framework — verification is `npx tsc --noEmit` + `npm run build` + direct SQL queries.
- Follow existing Sales module conventions exactly: `supabase.from('table' as any)` casts, `useToast()`, shadcn components already used in `ProductsPage.tsx`/`InvoiceDialog.tsx`/`InvoicesPage.tsx`. RPC style must match `create_invoice` precisely: SECURITY DEFINER, `SET search_path = public`, `is_crm_user()` check first, `jsonb_array_elements` loop for line items, `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated, service_role` after each function.
- Purchase order numbering: simple auto-increment (`GENERATED ALWAYS AS IDENTITY`), NOT the FY-reset pattern invoices use — POs have no compliance reason to reset yearly, unlike GST invoice numbering. Don't copy the `invoice_fy_counters` pattern here; it would be over-engineering for a need that doesn't exist.

---

### Task 1: Migration — 6 tables, RLS, `create_purchase_order`, `receive_grn`

**Files:**
- Create: `supabase/migrations/20260806_inventory_phase2_procurement.sql`

**Interfaces:**
- Produces: `inventory_suppliers`, `inventory_purchase_orders`, `inventory_po_items`, `inventory_grn`, `inventory_grn_items`, `inventory_supplier_payments` tables; `create_purchase_order(p_supplier_id, p_expected_date, p_notes, p_line_items jsonb) RETURNS jsonb` (returns `{id, po_number}`); `receive_grn(p_purchase_order_id, p_received_date, p_notes, p_items jsonb) RETURNS jsonb` (returns `{id, grn_number, po_status}`).

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260806_inventory_phase2_procurement.sql`

- [ ] **Step 3: Register the migration version**

```bash
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260806', 'inventory_phase2_procurement');"
```

- [ ] **Step 4: Verify schema**

```bash
supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'inventory_%' ORDER BY table_name;"
```
Expected: `inventory_grn`, `inventory_grn_items`, `inventory_po_items`, `inventory_purchase_orders`, `inventory_supplier_payments`, `inventory_suppliers` (6 rows).

- [ ] **Step 5: End-to-end smoke test of both RPCs against real (test) data**

```bash
# Create a test supplier
supabase db query --linked "INSERT INTO inventory_suppliers (name, contact_person, phone) VALUES ('TEST Supplier — delete me', 'Test Contact', '9999999999') RETURNING id;"
# Note the returned id, then (replace <SUPPLIER_ID> and pick a real product id from `SELECT id FROM products LIMIT 1`):
supabase db query --linked "SELECT create_purchase_order('<SUPPLIER_ID>'::uuid, current_date + 7, 'test PO', jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM products LIMIT 1), 'quantity_ordered', 10, 'unit_cost', 100)));"
# Note the returned id as <PO_ID>, then partially receive it:
supabase db query --linked "SELECT receive_grn('<PO_ID>'::uuid, current_date, 'partial receipt test', jsonb_build_array(jsonb_build_object('po_item_id', (SELECT id FROM inventory_po_items WHERE purchase_order_id = '<PO_ID>'::uuid), 'quantity_received', 4)));"
```
Expected: second call returns `po_status: "partially_received"` (4 of 10 received). Then verify the product's `stock_quantity` increased by exactly 4 (compare before/after), and `inventory_purchase_orders.status = 'partially_received'` for that PO.

- [ ] **Step 6: Clean up test data**

```bash
supabase db query --linked "DELETE FROM inventory_grn_items WHERE grn_id IN (SELECT id FROM inventory_grn WHERE purchase_order_id IN (SELECT id FROM inventory_purchase_orders WHERE supplier_id IN (SELECT id FROM inventory_suppliers WHERE name = 'TEST Supplier — delete me')));"
supabase db query --linked "DELETE FROM inventory_grn WHERE purchase_order_id IN (SELECT id FROM inventory_purchase_orders WHERE supplier_id IN (SELECT id FROM inventory_suppliers WHERE name = 'TEST Supplier — delete me'));"
supabase db query --linked "DELETE FROM inventory_po_items WHERE purchase_order_id IN (SELECT id FROM inventory_purchase_orders WHERE supplier_id IN (SELECT id FROM inventory_suppliers WHERE name = 'TEST Supplier — delete me'));"
supabase db query --linked "DELETE FROM inventory_purchase_orders WHERE supplier_id IN (SELECT id FROM inventory_suppliers WHERE name = 'TEST Supplier — delete me');"
supabase db query --linked "DELETE FROM inventory_suppliers WHERE name = 'TEST Supplier — delete me';"
```
**Important:** also manually revert the test product's `stock_quantity` back down by 4 (the amount the smoke test added in Step 5) — record its value before Step 5 and restore it exactly, since this test used a REAL product row, not a throwaway one.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260806_inventory_phase2_procurement.sql
git commit -m "Add inventory phase 2: procurement schema (suppliers, POs, GRN, supplier payments) + create_purchase_order/receive_grn RPCs"
```

---

### Task 2: Suppliers page (CRUD + payment recording)

**Files:**
- Create: `src/pages/Sales/SuppliersPage.tsx`
- Create: `src/pages/Sales/SupplierDialog.tsx` (add/edit supplier)
- Create: `src/pages/Sales/SupplierPaymentDialog.tsx` (record a payment against a supplier)
- Modify: `src/components/sales/SalesLayout.tsx` (add "Suppliers" nav item)
- Modify: `src/App.tsx` (add `/sales/suppliers` route)

**Interfaces:**
- Produces: `Supplier` type `{ id, name, contact_person, phone, email, address, gstin, is_active }`, exported from `SuppliersPage.tsx` for Task 3/4 to import (Purchase Order creation needs a supplier picker).

- [ ] **Step 1: Create `SupplierDialog.tsx`** — follow `ProductDialog.tsx`'s exact structure (controlled form, `emptyForm` constant, `useEffect` syncing `editing` prop to form state, `handleSave` doing insert-or-update via direct `supabase.from('inventory_suppliers' as any)` calls, toast on error, `onSaved` callback). Fields: Name (required), Contact Person, Phone, Email, Address (use `Textarea` from `@/components/ui/textarea`, already used in `InvoicesPage.tsx` for the void-reason field — same import path), GSTIN. No `is_active` field in the dialog — that's toggled from the list page like Products' active badge, not edited in the form.

- [ ] **Step 2: Create `SupplierPaymentDialog.tsx`** — simple dialog, props `{ open, onOpenChange, supplierId, supplierName, onSaved }`. Fields: Amount (number, required, >0), Payment Date (date input, default today), Payment Mode (Select: Cash/Cheque/Bank Transfer/UPI, matching the CHECK constraint from Task 1), Reference (text, optional), Notes (Textarea, optional). On save: direct `supabase.from('inventory_supplier_payments' as any).insert({ supplier_id: supplierId, amount, payment_date, payment_mode, reference: reference || null, notes: notes || null })`, toast, close, call `onSaved()`.

- [ ] **Step 3: Create `SuppliersPage.tsx`** — follow `ProductsPage.tsx`'s exact structure: `SalesLayout` wrapper, header with "Add Supplier" button, a `Table` listing Name / Contact Person / Phone / GSTIN / Active (toggle badge) / Actions (Edit, a "Record Payment" button opening `SupplierPaymentDialog`, Delete with `AlertDialog` confirmation — matches the existing delete-confirmation pattern in `ProductsPage.tsx`). Load suppliers via `supabase.from('inventory_suppliers' as any).select('*').order('name')`. Export the `Supplier` type from this file (matching how `ProductsPage.tsx` exports `Product`).

  Below the main table, add a collapsible or simply always-visible "Recent Payments" section per supplier row is overkill for a first cut — instead, add a small `₹{total_paid}` column computed from a second query (`supabase.from('inventory_supplier_payments' as any).select('supplier_id, amount')`, summed client-side per supplier) so staff can see running totals paid per supplier at a glance without opening anything.

- [ ] **Step 4: Wire nav + route** — in `SalesLayout.tsx`, add `{ label: 'Suppliers', href: '/sales/suppliers', icon: Truck }` to the `nav` array (import `Truck` from `lucide-react`, already a dependency). In `App.tsx`, import `SuppliersPage` from `./pages/Sales/SuppliersPage` and add `<Route path="/sales/suppliers" element={<ProtectedRoute><SuppliersPage /></ProtectedRoute>} />` alongside the existing `/sales/products`/`/sales/invoices` routes.

- [ ] **Step 5: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```
Both must be clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/SuppliersPage.tsx src/pages/Sales/SupplierDialog.tsx src/pages/Sales/SupplierPaymentDialog.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Suppliers page (CRUD + payment recording)"
```

---

### Task 3: Purchase Orders list + create dialog

**Files:**
- Create: `src/pages/Sales/PurchaseOrdersPage.tsx`
- Create: `src/pages/Sales/PurchaseOrderDialog.tsx` (create a new PO — no edit; a placed PO's line items don't change after the fact, only its status via receiving, which is Task 4)
- Modify: `src/components/sales/SalesLayout.tsx` (add "Purchase Orders" nav item)
- Modify: `src/App.tsx` (add `/sales/purchase-orders` route)

**Interfaces:**
- Consumes: `Supplier` type from `SuppliersPage.tsx` (Task 2); `Product` type from `ProductsPage.tsx` (Task 1 of Phase 1, already merged).
- Produces: nothing new consumed by later tasks in this plan except the route existing for Task 4's detail-page links.

- [ ] **Step 1: Create `PurchaseOrderDialog.tsx`** — follow `InvoiceDialog.tsx`'s line-item table pattern closely (`InvoiceDialog.tsx:264-316` is the reference: an editable `<table>` with a product-picker `Select` per row, add/remove row buttons, a running total). Adapt for PO items:
  - Header fields: Supplier (`Select` populated from `inventory_suppliers` where `is_active = true`, required), Expected Date (date input, optional), Notes (`Textarea`, optional).
  - Line item columns: Product (`Select` from `products` where `is_active = true` — do NOT filter by `item_type` here, unlike `InvoiceDialog.tsx`; you're allowed to purchase both consumables and saleables), Quantity Ordered (number, min 1), Unit Cost (number, min 0, step 0.01), Total (computed, read-only). No GST column — GST isn't relevant to a purchase order in this system (GST invoicing only applies to what iPlus sells to schools, not what it buys from suppliers).
  - On save: `supabase.rpc('create_purchase_order' as any, { p_supplier_id, p_expected_date, p_notes, p_line_items: [...] })` where each line item is `{ product_id, quantity_ordered, unit_cost }`. Toast on error, toast "Purchase order #<po_number> created" on success, call `onSaved()`, close.

- [ ] **Step 2: Create `PurchaseOrdersPage.tsx`** — follow `InvoicesPage.tsx`'s list-page structure: search (by supplier name or PO number), a status filter (`Select`: All/Draft/Ordered/Partially Received/Received/Cancelled), a `Table` with columns PO # / Supplier / Order Date / Expected Date / Status (colored `Badge` per status — reuse the `variant='destructive'`/`'default'`/`'outline'` pattern already used elsewhere, picking sensible mappings e.g. `cancelled`→destructive, `received`→default, others→outline) / Total (sum of `quantity_ordered * unit_cost` across that PO's items — either a second query joining `inventory_po_items`, or a Postgres view; for this task, simplest is fetching POs and their items together via `select('*, inventory_po_items(quantity_ordered, unit_cost)')` and summing client-side, matching how nested selects are used elsewhere in this codebase if any pattern exists, otherwise two separate queries joined client-side by `purchase_order_id`) / Actions (a "View" link/button routing to `/sales/purchase-orders/:id`, which Task 4 will implement — the route can exist and link to it now even though the detail page doesn't exist until Task 4 runs next).

- [ ] **Step 3: Wire nav + route** — add `{ label: 'Purchase Orders', href: '/sales/purchase-orders', icon: ClipboardList }` to `SalesLayout.tsx`'s `nav` array (import `ClipboardList` from `lucide-react`). Add the route in `App.tsx`.

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/PurchaseOrdersPage.tsx src/pages/Sales/PurchaseOrderDialog.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Purchase Orders list + create dialog"
```

---

### Task 4: Purchase Order detail page + GRN receiving

**Files:**
- Create: `src/pages/Sales/PurchaseOrderDetail.tsx`
- Create: `src/pages/Sales/ReceiveGrnDialog.tsx`
- Modify: `src/App.tsx` (add `/sales/purchase-orders/:id` route)

**Interfaces:**
- Consumes: the RPC contract from Task 1 (`receive_grn`).

- [ ] **Step 1: Create `ReceiveGrnDialog.tsx`** — props `{ open, onOpenChange, purchaseOrderId, poItems, onSaved }` where `poItems` is the array of `{ id, product_id, product_name, quantity_ordered, already_received }` passed down from the detail page (already_received = sum of prior GRN quantities for that po_item, so the dialog can show "X of Y ordered already received" and default the input to the remaining quantity, not the full ordered quantity). Fields: Received Date (date, default today), Notes (`Textarea`, optional), then one row per PO item showing Product name, Quantity Ordered, Already Received, and an editable "Receiving Now" number input (default = `quantity_ordered - already_received`, min 0, max unbounded — over-receiving is allowed, matching the warn-don't-block philosophy already established for stock in this codebase, not blocked here either). On save: `supabase.rpc('receive_grn' as any, { p_purchase_order_id, p_received_date, p_notes, p_items: poItems.map(i => ({ po_item_id: i.id, quantity_received: <that row's input value> })) })`. Rows where the input is 0 are fine to include — the RPC skips zero-quantity rows itself (per Task 1's `CONTINUE` on `v_qty_received <= 0`). Toast "Goods received — PO status: <po_status>" on success, call `onSaved()`, close.

- [ ] **Step 2: Create `PurchaseOrderDetail.tsx`** — route param `:id`. Loads the PO (`inventory_purchase_orders`), its supplier (join or second query), and its line items (`inventory_po_items` joined to `products` for name/current stock) plus, for each line item, the total already received (sum across `inventory_grn_items` for that `po_item_id` — one query: `select('po_item_id, quantity_received')` from `inventory_grn_items` where `po_item_id IN (...)`, summed client-side per item). Shows: PO header info (number, supplier, dates, status badge, notes), a table of line items (Product / Ordered / Received / Unit Cost / Line Total), and a "Receive Goods" button (disabled/hidden if `status` is `received` or `cancelled`) opening `ReceiveGrnDialog`. Below that, a simple GRN history list (`inventory_grn` rows for this PO, each showing date + a expandable/inline list of what was received in that batch — a flat list is fine for a first cut, no need for anything fancier).

- [ ] **Step 3: Wire route** — add `<Route path="/sales/purchase-orders/:id" element={<ProtectedRoute><PurchaseOrderDetail /></ProtectedRoute>} />` to `App.tsx`, and make `PurchaseOrdersPage.tsx`'s "View" action (from Task 3) actually navigate there (`useNavigate()` + `navigate(`/sales/purchase-orders/${po.id}`)`, or a plain `<Link>` — match whichever pattern `ProductsPage.tsx`/`InvoicesPage.tsx` already use for internal navigation, if any; otherwise `useNavigate` from `react-router-dom`, already imported in `SalesLayout.tsx`).

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: End-to-end verification via SQL** (no browser available in this environment)

Repeat a version of Task 1's Step 5/6 smoke test, but this time verify the *status transition sequence* a real user would trigger through the UI matches what the RPC computes: create a test PO with 2 line items, receive one fully and one partially, confirm status = `partially_received`; receive the remainder of the second item, confirm status flips to `received`. Clean up exactly as in Task 1 Step 6 (including reverting any real product's `stock_quantity`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/PurchaseOrderDetail.tsx src/pages/Sales/ReceiveGrnDialog.tsx src/App.tsx
git commit -m "Add Purchase Order detail page + goods-received (GRN) receiving flow"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's Phase 2 scope (Suppliers, Purchase Orders → GRN, Supplier Payments) fully covered across 4 tasks. Supplier Payments folded into Task 2 per the design doc's own note ("Supplier Payments folds into Phase 2, it's tracking payments against the same suppliers").
- **Type consistency:** `Supplier` type defined once (`SuppliersPage.tsx`), consumed by `PurchaseOrderDialog.tsx`. RPC parameter names (`p_supplier_id`, `p_line_items`, etc.) consistent between Task 1's SQL and every task's client-side `.rpc()` call.
- **No placeholders:** all SQL and the RPC contracts are complete; UI tasks explicitly reference existing files/line-ranges as the pattern to follow rather than leaving "similar to X" without specifics, per the file's own established conventions.
- **Deviation from the original design doc, flagged explicitly:** the design doc's Phase 2 sketch didn't specify PO numbering strategy; this plan chose simple auto-increment (not FY-reset) — see Global Constraints for the reasoning. Flag to Goghul if FY-reset PO numbering turns out to matter for reporting/compliance reasons not yet stated.
