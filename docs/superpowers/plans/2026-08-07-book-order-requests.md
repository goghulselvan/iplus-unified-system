# Book Order Requests (CRM/Sales side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CRM/Sales-side half of the book-ordering system: schema, RPCs, a standalone "Order Requests" page for staff to review payment proof, confirm orders, approve/reject line items, and a "Mark as Dispatched" button on the existing Invoice list. The portal-side ordering UI is a separate plan, built after this one ships.

**Architecture:** Two new tables (`product_orders`, `product_order_items`), one new column on `invoices` (`dispatched_at`), 7 SECURITY DEFINER RPCs, one trigger, and two new/modified UI surfaces in the Sales module. `approve_order_items` reuses the existing `create_invoice` RPC directly (calling one SECURITY DEFINER function from another — `auth.uid()` and the caller's role carry through the whole chain, this is a normal, safe pattern) rather than duplicating invoicing logic.

**Tech Stack:** Postgres (Supabase), React + TypeScript + Vite, shadcn/ui.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-07-book-order-requests-design.md`.
- Never `supabase db push` — apply with `supabase db query --linked --file <path>`, register in `supabase_migrations.schema_migrations`.
- Every RPC: SECURITY DEFINER, `SET search_path = public`, `is_crm_user()` first for staff RPCs / `get_portal_school_id()` ownership check first for portal RPCs, `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated, service_role`.
- Stock is gated at order time (enforced by `submit_product_order`, part of the not-yet-written portal spec) — `line_status` never has a "held, waiting for restock" state. Line items are `pending` → `invoiced_unpaid` → `paid` → `dispatched`, or `pending` → `rejected`. Nothing else.
- `unit_price` on `product_order_items` is a snapshot taken at order-submission time — never re-read from `products.unit_price` after that.
- One invoice never mixes line items from two different orders.
- Dispatch is per-invoice and requires the invoice to already be `paid` — `mark_invoice_dispatched` must reject a non-paid invoice.
- No test framework — verify via `npx tsc --noEmit` + `npm run build` + direct SQL smoke tests (before/after/cleanup discipline) using real existing school/product rows.
- Money formatting: `₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`. Date formatting: `new Date(dateStr).toLocaleDateString('en-IN')`. Both match every other Sales page.

---

### Task 1: Migration — schema, RLS

**Files:**
- Create: `supabase/migrations/20260807_book_order_requests.sql`

**Interfaces:**
- Produces: `product_orders(id, school_id, notes, payment_amount, payment_mode, payment_date, payment_utr_reference, payment_account_holder_name, payment_screenshot_url, payment_status, payment_review_note, payment_reviewed_by, payment_reviewed_at, confirmed_at, created_at)`; `product_order_items(id, order_id, product_id, quantity, unit_price, line_status, invoice_id, rejected_reason, rejected_by, rejected_at, created_at)`; `invoices.dispatched_at`.

- [ ] **Step 1: Write the migration**

```sql
-- Book Order Requests: schools order books via the portal (separate, not-yet-written spec);
-- this migration is the shared schema both the portal and the Sales module read/write through.

CREATE TABLE IF NOT EXISTS public.product_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  notes text,
  payment_amount numeric NOT NULL,
  payment_mode text NOT NULL,
  payment_date date NOT NULL,
  payment_utr_reference text,
  payment_account_holder_name text,
  payment_screenshot_url text NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','confirmed','resubmit_requested')),
  payment_review_note text,
  payment_reviewed_by uuid,
  payment_reviewed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.product_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.product_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN ('pending','invoiced_unpaid','paid','dispatched','rejected')),
  invoice_id uuid REFERENCES public.invoices(id),
  rejected_reason text,
  rejected_by uuid,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_order_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_product_order_items_order_id ON public.product_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_product_order_items_invoice_id ON public.product_order_items(invoice_id);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- Staff (CRM) can read every order.
DROP POLICY IF EXISTS "product_orders_select_staff" ON public.product_orders;
CREATE POLICY "product_orders_select_staff" ON public.product_orders FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "product_order_items_select_staff" ON public.product_order_items;
CREATE POLICY "product_order_items_select_staff" ON public.product_order_items FOR SELECT USING (is_crm_user());

-- School (portal) can read only its own orders — for the not-yet-written portal side.
DROP POLICY IF EXISTS "product_orders_select_school" ON public.product_orders;
CREATE POLICY "product_orders_select_school" ON public.product_orders FOR SELECT USING (school_id = get_portal_school_id());
DROP POLICY IF EXISTS "product_order_items_select_school" ON public.product_order_items;
CREATE POLICY "product_order_items_select_school" ON public.product_order_items FOR SELECT USING (
  order_id IN (SELECT id FROM public.product_orders WHERE school_id = get_portal_school_id())
);
-- No direct INSERT/UPDATE policies for either role — every write goes through a SECURITY DEFINER RPC.
```

- [ ] **Step 2: Apply + register**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260807_book_order_requests.sql
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260807', 'book_order_requests');"
```

- [ ] **Step 3: Verify schema**

```bash
supabase db query --linked "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('product_orders','product_order_items') ORDER BY table_name, ordinal_position;"
supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name='invoices' AND column_name='dispatched_at';"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807_book_order_requests.sql
git commit -m "Add book order requests schema: product_orders, product_order_items, invoices.dispatched_at"
```

---

### Task 2: RPCs — order intake and payment review

**Files:**
- Create: `supabase/migrations/20260807d_book_order_requests_intake_rpcs.sql`

**Interfaces:**
- Consumes: `product_orders`/`product_order_items` from Task 1; `products(id, unit_price, stock_quantity, is_active)`; `get_portal_school_id()` (existing).
- Produces: `submit_product_order(p_school_id, p_items jsonb, p_payment_mode, p_payment_date, p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url, p_notes) RETURNS uuid`; `confirm_product_order_payment(p_order_id) RETURNS void`; `request_order_payment_resubmit(p_order_id, p_reason) RETURNS void`; `resubmit_product_order_payment(p_order_id, p_payment_mode, p_payment_date, p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url) RETURNS void`.

- [ ] **Step 1: Write the migration**

```sql
-- ── submit_product_order ────────────────────────────────────────────────────
-- p_items shape: [{"product_id": "uuid", "quantity": 3}, ...]
CREATE OR REPLACE FUNCTION public.submit_product_order(
  p_school_id uuid,
  p_items jsonb,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_stock integer;
  v_total numeric := 0;
BEGIN
  IF p_school_id IS NULL OR p_school_id IS DISTINCT FROM get_portal_school_id() THEN
    RAISE EXCEPTION 'Not authorized for this school';
  END IF;
  IF p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  INSERT INTO product_orders (
    school_id, notes, payment_amount, payment_mode, payment_date,
    payment_utr_reference, payment_account_holder_name, payment_screenshot_url
  ) VALUES (
    p_school_id, p_notes, 0, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive';
    END IF;

    SELECT unit_price, stock_quantity INTO v_unit_price, v_stock
    FROM products WHERE id = v_product_id AND is_active = true;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Product not found or inactive';
    END IF;
    IF v_quantity > v_stock THEN
      RAISE EXCEPTION 'Requested quantity exceeds available stock for this product';
    END IF;

    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  UPDATE product_orders SET payment_amount = v_total WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_product_order(uuid, jsonb, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_product_order(uuid, jsonb, text, date, text, text, text, text) TO authenticated, service_role;

-- ── confirm_product_order_payment ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_product_order_payment(p_order_id uuid)
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

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Order already confirmed';
  END IF;

  UPDATE product_orders
  SET payment_status = 'confirmed',
      confirmed_at = now(),
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now(),
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid) TO authenticated, service_role;

-- ── request_order_payment_resubmit ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_order_payment_resubmit(p_order_id uuid, p_reason text)
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
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Cannot request resubmit on an already-confirmed order';
  END IF;

  UPDATE product_orders
  SET payment_status = 'resubmit_requested',
      payment_review_note = trim(p_reason),
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now()
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_order_payment_resubmit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_order_payment_resubmit(uuid, text) TO authenticated, service_role;

-- ── resubmit_product_order_payment ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resubmit_product_order_payment(
  p_order_id uuid,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_status text;
BEGIN
  SELECT school_id, payment_status INTO v_school_id, v_status
  FROM product_orders WHERE id = p_order_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_school_id IS DISTINCT FROM get_portal_school_id() THEN
    RAISE EXCEPTION 'Not authorized for this order';
  END IF;
  IF v_status != 'resubmit_requested' THEN
    RAISE EXCEPTION 'This order is not awaiting resubmission';
  END IF;
  IF p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;

  UPDATE product_orders
  SET payment_mode = p_payment_mode,
      payment_date = p_payment_date,
      payment_utr_reference = p_payment_utr_reference,
      payment_account_holder_name = p_payment_account_holder_name,
      payment_screenshot_url = p_payment_screenshot_url,
      payment_status = 'pending',
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resubmit_product_order_payment(uuid, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_product_order_payment(uuid, text, date, text, text, text) TO authenticated, service_role;
```

- [ ] **Step 2: Apply + register**

```bash
supabase db query --linked --file supabase/migrations/20260807d_book_order_requests_intake_rpcs.sql
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260807d', 'book_order_requests_intake_rpcs');"
```

- [ ] **Step 3: End-to-end smoke test**

Pick one real school ID and one real active product with `stock_quantity > 2` (query `SELECT id FROM schools LIMIT 1;` and `SELECT id, stock_quantity FROM products WHERE is_active = true AND stock_quantity > 2 LIMIT 1;` to get real values first). Then, using an authenticated session (the `supabase` CLI's `db query --linked` runs as a privileged role, not a real portal session — since `get_portal_school_id()` depends on `auth.uid()`, this RPC's positive path can't be smoke-tested directly via CLI the way staff-side RPCs can. Instead, verify the negative/guard paths, which don't depend on a real session):

```bash
# Confirm the school-ownership guard rejects a mismatched school_id (expect an error, not a row)
supabase db query --linked "SELECT submit_product_order((SELECT id FROM schools LIMIT 1), '[{\"product_id\":\"00000000-0000-0000-0000-000000000000\",\"quantity\":1}]'::jsonb, 'UPI', current_date, null, null, 'http://example.com/proof.jpg', null);"
```

Expected: an error (either the ownership check or "Product not found" — both prove the function runs and its guards fire; a passing/succeeding call here would indicate the ownership check is broken, since this CLI session is not a real portal user). Verify `confirm_product_order_payment`/`request_order_payment_resubmit`'s `is_crm_user()`-gated paths the same way every other staff RPC in this module has been verified all session — insert a throwaway `product_orders` row directly via SQL (bypassing the RPC, since CLI isn't a real staff session either), call the RPC, check the row updated, then delete the throwaway row:

```bash
supabase db query --linked "INSERT INTO product_orders (school_id, payment_amount, payment_mode, payment_date, payment_screenshot_url) VALUES ((SELECT id FROM schools LIMIT 1), 100, 'UPI', current_date, 'http://example.com/x.jpg') RETURNING id;"
# copy the returned id, call:
supabase db query --linked "SELECT confirm_product_order_payment('<id>');"
supabase db query --linked "SELECT payment_status, confirmed_at FROM product_orders WHERE id = '<id>';"
# expect payment_status = 'confirmed', confirmed_at set
supabase db query --linked "DELETE FROM product_orders WHERE id = '<id>';"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807d_book_order_requests_intake_rpcs.sql
git commit -m "Add book order intake RPCs: submit, confirm, request resubmit, resubmit"
```

---

### Task 3: RPCs — approve/reject/dispatch + payment-sync trigger

**Files:**
- Create: `supabase/migrations/20260807e_book_order_requests_fulfillment_rpcs.sql`

**Interfaces:**
- Consumes: `create_invoice` (existing, exact signature `create_invoice(p_school_id uuid, p_prospect_school_id uuid, p_buyer_name text, p_buyer_address text, p_buyer_state text, p_buyer_gstin text, p_payment_method text, p_line_items jsonb) RETURNS jsonb` — returns `{id, invoice_number, fy}`); `mark_invoice_paid` (existing, unchanged); `schools(school_name, school_address, state)`; `product_order_items`/`product_orders` from Tasks 1-2.
- Produces: `approve_order_items(p_order_id, p_item_ids uuid[]) RETURNS uuid`; `reject_order_items(p_order_id, p_item_ids uuid[], p_reason) RETURNS void`; `mark_invoice_dispatched(p_invoice_id) RETURNS void`; trigger `trg_sync_order_items_on_invoice_paid`.

- [ ] **Step 1: Write the migration**

```sql
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
  ELSIF NEW.status != 'paid' AND OLD.status = 'paid' THEN
    -- Invoice un-marked as paid — revert any linked item that hadn't dispatched yet.
    -- Items already 'dispatched' stay dispatched (the books already physically left).
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
```

- [ ] **Step 2: Apply + register**

```bash
supabase db query --linked --file supabase/migrations/20260807e_book_order_requests_fulfillment_rpcs.sql
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260807e', 'book_order_requests_fulfillment_rpcs');"
```

- [ ] **Step 3: End-to-end smoke test (staff-side RPCs, verified via direct SQL setup since CLI isn't a real staff session)**

Record a real product's `stock_quantity` before starting (`SELECT id, stock_quantity, name, hsn_code, gst_rate, unit_price FROM products WHERE is_active = true AND stock_quantity > 1 LIMIT 1;`) and a real school (`SELECT id, school_name FROM schools LIMIT 1;`).

```bash
# Set up a throwaway confirmed order with one pending item
supabase db query --linked "INSERT INTO product_orders (school_id, payment_amount, payment_mode, payment_date, payment_screenshot_url, payment_status, confirmed_at) VALUES ('<school_id>', 100, 'UPI', current_date, 'http://example.com/x.jpg', 'confirmed', now()) RETURNING id;"
# copy order id, then:
supabase db query --linked "INSERT INTO product_order_items (order_id, product_id, quantity, unit_price) VALUES ('<order_id>', '<product_id>', 1, <unit_price>) RETURNING id;"
# copy item id, then approve it:
supabase db query --linked "SELECT approve_order_items('<order_id>', ARRAY['<item_id>']::uuid[]);"
# expect: returns an invoice id, no error
supabase db query --linked "SELECT line_status, invoice_id FROM product_order_items WHERE id = '<item_id>';"
# expect: line_status = 'invoiced_unpaid', invoice_id set
supabase db query --linked "SELECT stock_quantity FROM products WHERE id = '<product_id>';"
# expect: decreased by 1 (create_invoice's own stock-decrement fired)

# Mark that invoice paid via the existing RPC, confirm the trigger synced the item
supabase db query --linked "SELECT mark_invoice_paid('<invoice_id>', true);"
supabase db query --linked "SELECT line_status FROM product_order_items WHERE id = '<item_id>';"
# expect: line_status = 'paid'

# Dispatch it
supabase db query --linked "SELECT mark_invoice_dispatched('<invoice_id>');"
supabase db query --linked "SELECT line_status FROM product_order_items WHERE id = '<item_id>'; SELECT dispatched_at FROM invoices WHERE id = '<invoice_id>';"
# expect: line_status = 'dispatched', dispatched_at set

# Cleanup: restore stock, delete the test invoice/order rows
supabase db query --linked "UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = '<product_id>';"
supabase db query --linked "DELETE FROM invoice_line_items WHERE invoice_id = '<invoice_id>'; DELETE FROM invoices WHERE id = '<invoice_id>'; DELETE FROM product_order_items WHERE order_id = '<order_id>'; DELETE FROM product_orders WHERE id = '<order_id>';"
```

Separately, verify `reject_order_items` on a second throwaway pending item (same setup pattern): call it with a reason, confirm `line_status='rejected'`, `rejected_reason` set, then clean up.

Separately, verify `mark_invoice_dispatched` rejects a non-paid invoice: create a throwaway `unpaid` invoice (no order link needed), call `mark_invoice_dispatched` on it, expect an error, clean up.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807e_book_order_requests_fulfillment_rpcs.sql
git commit -m "Add book order fulfillment RPCs: approve (creates invoice), reject, dispatch, paid-sync trigger"
```

---

### Task 4: Sales module — Order Requests page (list + detail)

**Files:**
- Create: `src/pages/Sales/OrderRequestsPage.tsx`
- Create: `src/pages/Sales/OrderRequestDetail.tsx`
- Modify: `src/components/sales/SalesLayout.tsx` (add nav item)
- Modify: `src/App.tsx` (add routes)

**Interfaces:**
- Consumes: `product_orders`, `product_order_items` (joined to `products(name)` and `invoices(invoice_number, fy, status)`), `schools(school_name)`; RPCs from Tasks 2-3.

- [ ] **Step 1: Create `OrderRequestsPage.tsx`**

```tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type PaymentStatus = 'pending' | 'confirmed' | 'resubmit_requested';
type LineStatus = 'pending' | 'invoiced_unpaid' | 'paid' | 'dispatched' | 'rejected';

type OrderRow = {
  id: string;
  payment_amount: number;
  payment_status: PaymentStatus;
  created_at: string;
  schools: { school_name: string } | null;
  product_order_items: { line_status: LineStatus }[];
};

const PAGE_SIZE = 200;

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending Review',
  confirmed: 'Confirmed',
  resubmit_requested: 'Resubmit Requested',
};

const paymentBadge = (s: PaymentStatus) => {
  if (s === 'confirmed') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{PAYMENT_LABELS[s]}</Badge>;
  if (s === 'resubmit_requested') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{PAYMENT_LABELS[s]}</Badge>;
  return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{PAYMENT_LABELS[s]}</Badge>;
};

const rollup = (items: { line_status: LineStatus }[]) => {
  if (items.length === 0) return '—';
  const counts: Record<LineStatus, number> = { pending: 0, invoiced_unpaid: 0, paid: 0, dispatched: 0, rejected: 0 };
  items.forEach(i => { counts[i.line_status]++; });
  const parts: string[] = [];
  if (counts.dispatched) parts.push(`${counts.dispatched} dispatched`);
  if (counts.paid) parts.push(`${counts.paid} paid`);
  if (counts.invoiced_unpaid) parts.push(`${counts.invoiced_unpaid} invoiced`);
  if (counts.pending) parts.push(`${counts.pending} pending`);
  if (counts.rejected) parts.push(`${counts.rejected} rejected`);
  return parts.join(' · ') || '—';
};

export default function OrderRequestsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    setError(false);
    const { data, error: loadErr } = await supabase
      .from('product_orders' as any)
      .select('id, payment_amount, payment_status, created_at, schools(school_name), product_order_items(line_status)')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (loadErr) {
      setError(true);
      toast({ title: 'Error', description: loadErr.message, variant: 'destructive' });
    } else {
      setOrders((data || []) as unknown as OrderRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => statusFilter === 'all' ? orders : orders.filter(o => o.payment_status === statusFilter),
    [orders, statusFilter]
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Order Requests</h1>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending Review</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="resubmit_requested">Resubmit Requested</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No order requests.</TableCell></TableRow>
              ) : (
                filtered.map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => navigate(`/sales/order-requests/${o.id}`)}>
                    <TableCell className="font-medium">{o.schools?.school_name ?? '—'}</TableCell>
                    <TableCell>₹{o.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{paymentBadge(o.payment_status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rollup(o.product_order_items)}</TableCell>
                    <TableCell>{new Date(o.created_at).toLocaleDateString('en-IN')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </SalesLayout>
  );
}
```

- [ ] **Step 2: Create `OrderRequestDetail.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type PaymentStatus = 'pending' | 'confirmed' | 'resubmit_requested';
type LineStatus = 'pending' | 'invoiced_unpaid' | 'paid' | 'dispatched' | 'rejected';

type OrderDetail = {
  id: string;
  notes: string | null;
  payment_amount: number;
  payment_mode: string;
  payment_date: string;
  payment_utr_reference: string | null;
  payment_account_holder_name: string | null;
  payment_screenshot_url: string;
  payment_status: PaymentStatus;
  payment_review_note: string | null;
  schools: { school_name: string } | null;
};

type ItemRow = {
  id: string;
  quantity: number;
  unit_price: number;
  line_status: LineStatus;
  rejected_reason: string | null;
  products: { name: string } | null;
  invoices: { invoice_number: number; fy: number } | null;
};

const LINE_LABELS: Record<LineStatus, string> = {
  pending: 'Pending', invoiced_unpaid: 'Invoiced (Unpaid)', paid: 'Paid', dispatched: 'Dispatched', rejected: 'Rejected',
};

const lineBadge = (s: LineStatus) => {
  if (s === 'dispatched') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'paid') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'invoiced_unpaid') return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'rejected') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{LINE_LABELS[s]}</Badge>;
  return <Badge variant="outline" className="bg-neutral-100 text-neutral-500 border-neutral-200">{LINE_LABELS[s]}</Badge>;
};

export default function OrderRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitReason, setResubmitReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    const [orderRes, itemsRes] = await Promise.all([
      supabase.from('product_orders' as any)
        .select('id, notes, payment_amount, payment_mode, payment_date, payment_utr_reference, payment_account_holder_name, payment_screenshot_url, payment_status, payment_review_note, schools(school_name)')
        .eq('id', id).single(),
      supabase.from('product_order_items' as any)
        .select('id, quantity, unit_price, line_status, rejected_reason, products(name), invoices(invoice_number, fy)')
        .eq('order_id', id),
    ]);
    if (orderRes.error) toast({ title: 'Error', description: orderRes.error.message, variant: 'destructive' });
    else setOrder(orderRes.data as unknown as OrderDetail);
    if (itemsRes.error) toast({ title: 'Error', description: itemsRes.error.message, variant: 'destructive' });
    else setItems((itemsRes.data || []) as unknown as ItemRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const toggleSelected = (itemId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const handleConfirm = async () => {
    const { error } = await supabase.rpc('confirm_product_order_payment' as any, { p_order_id: id });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Order confirmed' });
    load();
  };

  const handleRequestResubmit = async () => {
    if (!resubmitReason.trim()) return;
    const { error } = await supabase.rpc('request_order_payment_resubmit' as any, { p_order_id: id, p_reason: resubmitReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Resubmit requested' });
    setResubmitOpen(false); setResubmitReason('');
    load();
  };

  const handleApprove = async () => {
    if (selected.size === 0) return;
    const { data, error } = await supabase.rpc('approve_order_items' as any, { p_order_id: id, p_item_ids: Array.from(selected) });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invoice created' });
    setSelected(new Set());
    load();
  };

  const handleReject = async () => {
    if (selected.size === 0 || !rejectReason.trim()) return;
    const { error } = await supabase.rpc('reject_order_items' as any, { p_order_id: id, p_item_ids: Array.from(selected), p_reason: rejectReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Items rejected' });
    setRejectOpen(false); setRejectReason(''); setSelected(new Set());
    load();
  };

  if (loading || !order) {
    return <SalesLayout><div className="max-w-4xl mx-auto px-4 py-8 text-muted-foreground">Loading…</div></SalesLayout>;
  }

  return (
    <SalesLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/sales/order-requests')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Order Requests
        </button>

        <h1 className="text-3xl font-bold mb-1">{order.schools?.school_name ?? '—'}</h1>
        <p className="text-sm text-muted-foreground mb-6">₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {order.payment_mode} · {new Date(order.payment_date).toLocaleDateString('en-IN')}</p>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Payment Proof</div>
          </div>
          <img src={order.payment_screenshot_url} alt="Payment proof" className="max-w-sm rounded-lg border border-neutral-200 mb-3" />
          <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
            <div>UTR / Reference: {order.payment_utr_reference || '—'}</div>
            <div>Account Holder: {order.payment_account_holder_name || '—'}</div>
          </div>
          {order.payment_review_note && (
            <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-lg p-3">Resubmit reason: {order.payment_review_note}</div>
          )}

          {order.payment_status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button onClick={handleConfirm}>Confirm Order</Button>
              <Button variant="outline" onClick={() => setResubmitOpen(true)}>Request Resubmit</Button>
            </div>
          )}
          {order.payment_status === 'resubmit_requested' && (
            <p className="text-sm text-amber-600 mt-4">Waiting for the school to resubmit payment proof.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {order.payment_status === 'confirmed' && <TableHead className="w-10"></TableHead>}
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  {order.payment_status === 'confirmed' && (
                    <TableCell>
                      {i.line_status === 'pending' && (
                        <Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggleSelected(i.id)} />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="font-medium">{i.products?.name ?? '—'}</TableCell>
                  <TableCell>{i.quantity}</TableCell>
                  <TableCell>₹{i.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {lineBadge(i.line_status)}
                    {i.line_status === 'rejected' && i.rejected_reason && (
                      <div className="text-xs text-muted-foreground mt-1">{i.rejected_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>{i.invoices ? `INV ${i.invoices.fy}-${i.invoices.invoice_number}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {order.payment_status === 'confirmed' && (
          <div className="flex gap-2 mt-4">
            <Button onClick={handleApprove} disabled={selected.size === 0}>Approve Selected → Create Invoice</Button>
            <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={selected.size === 0}>Reject Selected</Button>
          </div>
        )}
      </div>

      <Dialog open={resubmitOpen} onOpenChange={setResubmitOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Payment Resubmit</DialogTitle></DialogHeader>
          <Textarea value={resubmitReason} onChange={e => setResubmitReason(e.target.value)} placeholder="Reason (shown to the school)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResubmitOpen(false)}>Cancel</Button>
            <Button onClick={handleRequestResubmit} disabled={!resubmitReason.trim()}>Request Resubmit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Selected Items</DialogTitle></DialogHeader>
          <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason (shown to the school)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SalesLayout>
  );
}
```

- [ ] **Step 3: Wire nav + routes**

In `src/components/sales/SalesLayout.tsx`, add `PackageSearch` (or another distinct icon) to the `lucide-react` import line, and add `{ label: 'Order Requests', href: '/sales/order-requests', icon: PackageSearch }` to the `nav` array as a standalone entry (not inside a dropdown group — matches the user's explicit "standalone" instruction), placed after `Dashboard`.

In `src/App.tsx`, add:
```tsx
import OrderRequestsPage from "./pages/Sales/OrderRequestsPage";
import OrderRequestDetail from "./pages/Sales/OrderRequestDetail";
```
and:
```tsx
<Route path="/sales/order-requests" element={<ProtectedRoute><OrderRequestsPage /></ProtectedRoute>} />
<Route path="/sales/order-requests/:id" element={<ProtectedRoute><OrderRequestDetail /></ProtectedRoute>} />
```

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/OrderRequestsPage.tsx src/pages/Sales/OrderRequestDetail.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Order Requests page (list + detail): payment review, approve/reject, invoice creation"
```

---

### Task 5: Invoices page — "Mark as Dispatched" button

**Files:**
- Modify: `src/pages/Sales/InvoicesPage.tsx`

**Interfaces:**
- Consumes: `mark_invoice_dispatched` RPC (Task 3).

- [ ] **Step 1: Add `dispatched_at` to the row type and query**

Replace:
```tsx
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
```
with:
```tsx
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
  dispatched_at: string | null;
};
```

Replace:
```tsx
      .select('id, invoice_number, fy, buyer_name, school_id, prospect_school_id, payment_method, status, grand_total, created_at')
```
with:
```tsx
      .select('id, invoice_number, fy, buyer_name, school_id, prospect_school_id, payment_method, status, grand_total, created_at, dispatched_at')
```

- [ ] **Step 2: Add the dispatch handler**

Add near the other action handlers (e.g. after the void/delete handlers):
```tsx
  const handleDispatch = async (invoiceId: string) => {
    const { error } = await supabase.rpc('mark_invoice_dispatched' as any, { p_invoice_id: invoiceId });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Marked as dispatched' });
    loadInvoices();
  };
```

- [ ] **Step 3: Add the button**

Find the row-actions cell containing the existing Void (`Ban`) and Delete (`Trash2`) buttons. Add a new button before them, shown only when the invoice is paid and not yet dispatched:
```tsx
                        {row.status === 'paid' && !row.dispatched_at && (
                          <Button variant="ghost" size="sm" onClick={() => handleDispatch(row.id)}><Truck className="h-3.5 w-3.5 text-emerald-600" /></Button>
                        )}
```

Add `Truck` to the existing `lucide-react` import line (`import { Plus, Download, Pencil, Ban, Trash2, Search } from 'lucide-react';` → add `Truck`).

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/InvoicesPage.tsx
git commit -m "Add Mark as Dispatched button to Invoices page"
```

---

## Self-Review Notes

- **Spec coverage:** every RPC, the trigger, the new table pair, `invoices.dispatched_at`, the standalone Order Requests page, and the Invoice dispatch button are all covered — matches every section of the design doc.
- **No placeholders:** every RPC has complete, real SQL; both new page components are complete, real TSX.
- **Type consistency:** `PaymentStatus`/`LineStatus` union types match the DB CHECK constraints exactly and are used identically across `OrderRequestsPage.tsx` and `OrderRequestDetail.tsx`.
- **Known limitation, deliberately deferred:** `approve_order_items`' stock re-check and `create_invoice`'s own decrement are two separate statements — a genuine concurrent double-approval could still both pass the re-check before either decrements. This matches `create_invoice`'s own pre-existing warn-don't-block philosophy (it already tolerates negative stock by design), so this isn't a new risk class being introduced, just an existing, accepted one. Not treated as a bug to fix in this plan.
- **Smoke testing:** `submit_product_order`/`resubmit_product_order_payment` depend on `auth.uid()` via `get_portal_school_id()`, which the CLI session doesn't have — their negative/guard paths are verified instead, and their full positive-path testing happens naturally once the portal-side plan (which runs as a real browser session) is built and Goghul clicks through both sides together.
