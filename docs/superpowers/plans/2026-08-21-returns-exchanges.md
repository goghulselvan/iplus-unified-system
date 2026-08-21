# Returns & Exchanges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff track a wrong/damaged book coming back on a specific invoice line, restock or write it off on confirmed receipt, issue a Credit Note for its value, and apply that credit to a replacement order or refund it in cash — without ever editing the original invoice.

**Architecture:** Three new tables (`product_returns`, `credit_notes`, `credit_note_applications`) plus a `credit_notes_with_balance` view overlay the existing invoice/order schema without touching it. Five new/extended RPCs drive the whole lifecycle. Four new/modified React components surface it in the Sales module.

**Tech Stack:** Supabase Postgres (SQL migrations, `SECURITY DEFINER` RPCs), React + TypeScript, Supabase JS client, shadcn/ui components (existing patterns in `vg-iplus-crm-main`).

**Spec:** `docs/superpowers/specs/2026-08-21-returns-exchanges-design.md`

## Global Constraints

- Returns only apply to invoices with `school_id` set (never `prospect_school_id`) — Book Order Requests are always school-billed, matching the existing `product_orders.school_id NOT NULL` constraint.
- The original `invoices` / `invoice_line_items` rows are **never** updated by any RPC in this plan.
- Money/stock-moving actions (`confirm_return_received`, `issue_credit_refund`) are gated to `role IN ('superadmin', 'accountant')` — the exact inline check already used on `invoices_update`/`invoices_delete`, deliberately excluding manager. Reporting a return (`report_return`) is open to any CRM staff, same as creating an order.
- `condition_on_receipt` (`resellable`/`damaged`) is required on every `confirm_return_received` call — no default.
- Stock restoration uses an atomic `UPDATE ... RETURNING`, never read-then-check-then-write (the concurrency-bug pattern already fixed once in this module's Phase 3).
- The `credit_notes_with_balance` view **must** be declared `WITH (security_invoker = true)` — Phase 2 of the inventory rebuild shipped a summary view without this and it silently bypassed RLS; not repeating that.
- No Credit Note PDF, no new WhatsApp/email templates, no portal-side changes — all out of scope per the spec.
- This codebase has no automated frontend test suite (confirmed across every prior Sales-module spec). Frontend task "tests" are `tsc --noEmit` (a real, runnable gate) plus a concrete manual browser-verification checklist — not fabricated unit tests. Backend RPC tasks get genuine TDD: a runnable SQL assertion written and run before the function exists (fails with "function does not exist"), then again after (passes).
- Apply each migration via Supabase MCP `apply_migration` (name = the file's basename without `.sql`) against the linked project, or `supabase db query --linked --file supabase/migrations/<file>.sql` if working from the CLI.

---

### Task 1: Schema — returns, credit notes, and their ledger

**Files:**
- Create: `supabase/migrations/20260821_returns_exchanges_schema.sql`

**Interfaces:**
- Produces: tables `product_returns(id, invoice_line_item_id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_by, requested_at, received_by, received_at)`, `credit_notes(id, credit_note_number, fy, school_id, source_return_id, amount, note, created_by, created_at)`, `credit_note_fy_counters(fy, last_no)`, `credit_note_applications(id, credit_note_id, application_type, amount, applied_to_invoice_id, refund_mode, refund_reference, note, recorded_by, recorded_at)`; view `credit_notes_with_balance` (all `credit_notes` columns + `remaining_balance`); new columns `product_orders.applied_credit_note_id`, `product_orders.applied_credit_amount`, `product_orders.credit_applied_to_invoice`; `product_orders.payment_screenshot_url` becomes nullable.

- [ ] **Step 1: Write the verification script and confirm it fails**

Create `/tmp/verify_returns_schema.sql`:

```sql
-- Should fail today: none of these exist yet.
SELECT 'product_returns' AS check, to_regclass('public.product_returns') IS NOT NULL AS ok
UNION ALL SELECT 'credit_notes', to_regclass('public.credit_notes') IS NOT NULL
UNION ALL SELECT 'credit_note_fy_counters', to_regclass('public.credit_note_fy_counters') IS NOT NULL
UNION ALL SELECT 'credit_note_applications', to_regclass('public.credit_note_applications') IS NOT NULL
UNION ALL SELECT 'credit_notes_with_balance view', to_regclass('public.credit_notes_with_balance') IS NOT NULL
UNION ALL SELECT 'product_orders.applied_credit_note_id', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'product_orders' AND column_name = 'applied_credit_note_id'
)
UNION ALL SELECT 'payment_screenshot_url nullable', (
  SELECT is_nullable = 'YES' FROM information_schema.columns
  WHERE table_name = 'product_orders' AND column_name = 'payment_screenshot_url'
);
```

Run it via `mcp__supabase__execute_sql`. Expected: every row's `ok` is `false` (or the query errors on `to_regclass` referencing a genuinely absent relation is fine too — either way, nothing passes).

- [ ] **Step 2: Write the migration**

```sql
-- Returns & Exchanges: return tracking, credit notes, and the ledger of how
-- each credit note gets used. See docs/superpowers/specs/2026-08-21-returns-exchanges-design.md.

CREATE TABLE public.product_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_line_item_id uuid NOT NULL REFERENCES public.invoice_line_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason_category text NOT NULL CHECK (reason_category IN (
    'wrong_item_shipped', 'wrong_item_ordered_by_staff', 'damaged_in_transit', 'other'
  )),
  reason_note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received')),
  condition_on_receipt text CHECK (condition_on_receipt IN ('resellable', 'damaged')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  received_at timestamptz,
  CONSTRAINT product_returns_condition_set_on_receipt CHECK (
    (status = 'requested' AND condition_on_receipt IS NULL) OR
    (status = 'received' AND condition_on_receipt IS NOT NULL)
  )
);
ALTER TABLE public.product_returns ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_product_returns_invoice_line_item_id ON public.product_returns(invoice_line_item_id);
CREATE INDEX idx_product_returns_status ON public.product_returns(status);

DROP POLICY IF EXISTS "product_returns_select" ON public.product_returns;
CREATE POLICY "product_returns_select" ON public.product_returns FOR SELECT USING (is_crm_user());
-- No insert/update policy — all writes go through report_return/confirm_return_received.

CREATE TABLE public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number integer,
  fy smallint,
  school_id uuid NOT NULL REFERENCES public.schools(id),
  source_return_id uuid NOT NULL REFERENCES public.product_returns(id),
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_credit_notes_school_id ON public.credit_notes(school_id);

DROP POLICY IF EXISTS "credit_notes_select" ON public.credit_notes;
CREATE POLICY "credit_notes_select" ON public.credit_notes FOR SELECT USING (is_crm_user());
-- No insert/update policy — only confirm_return_received (SECURITY DEFINER) mints these.

CREATE TABLE public.credit_note_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
ALTER TABLE public.credit_note_fy_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.credit_note_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id),
  application_type text NOT NULL CHECK (application_type IN ('invoice', 'refund')),
  amount numeric NOT NULL CHECK (amount > 0),
  applied_to_invoice_id uuid REFERENCES public.invoices(id),
  refund_mode text,
  refund_reference text,
  note text,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_applications_shape_check CHECK (
    (application_type = 'invoice' AND applied_to_invoice_id IS NOT NULL AND refund_mode IS NULL) OR
    (application_type = 'refund' AND applied_to_invoice_id IS NULL AND refund_mode IS NOT NULL)
  )
);
ALTER TABLE public.credit_note_applications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_credit_note_applications_credit_note_id ON public.credit_note_applications(credit_note_id);

DROP POLICY IF EXISTS "credit_note_applications_select" ON public.credit_note_applications;
CREATE POLICY "credit_note_applications_select" ON public.credit_note_applications FOR SELECT USING (is_crm_user());
-- No insert/update policy — only approve_order_items / issue_credit_refund (SECURITY DEFINER) write these.

-- Remaining balance is always computed, never stored, so it can't drift from its
-- applications. security_invoker is mandatory — see Global Constraints.
CREATE VIEW public.credit_notes_with_balance
WITH (security_invoker = true) AS
SELECT cn.*,
  cn.amount - COALESCE((
    SELECT SUM(ca.amount) FROM public.credit_note_applications ca WHERE ca.credit_note_id = cn.id
  ), 0) AS remaining_balance
FROM public.credit_notes cn;

ALTER TABLE public.product_orders
  ADD COLUMN applied_credit_note_id uuid REFERENCES public.credit_notes(id),
  ADD COLUMN applied_credit_amount numeric CHECK (applied_credit_amount IS NULL OR applied_credit_amount > 0),
  ADD COLUMN credit_applied_to_invoice boolean NOT NULL DEFAULT false;

-- Only a manual order fully covered by credit has nothing to prove. Portal intake
-- (submit_product_order) never applies credit, so its UI keeps the upload mandatory
-- in practice — this relaxes the column, not the portal's own requirement.
ALTER TABLE public.product_orders ALTER COLUMN payment_screenshot_url DROP NOT NULL;
```

- [ ] **Step 3: Apply the migration**

Via `mcp__supabase__apply_migration` with `name: "20260821_returns_exchanges_schema"` and the SQL above as `query`.

- [ ] **Step 4: Re-run the verification script and confirm it passes**

Run the same script from Step 1 via `mcp__supabase__execute_sql`. Expected: every row's `ok` is `true`.

- [ ] **Step 5: Verify the condition/status CHECK constraint actually rejects bad states**

```sql
BEGIN;
INSERT INTO invoice_line_items (id, invoice_id, item_name, gst_rate, quantity, unit_price, line_total, row_order)
SELECT gen_random_uuid(), id, 'test', 0, 1, 100, 100, 999 FROM invoices LIMIT 1;
-- This should fail: status defaults to 'requested' but condition_on_receipt is being set.
INSERT INTO product_returns (invoice_line_item_id, quantity, reason_category, status, condition_on_receipt, requested_by)
SELECT ili.id, 1, 'other', 'requested', 'resellable', requested_by
FROM invoice_line_items ili, (SELECT gen_random_uuid() AS requested_by) x
WHERE ili.item_name = 'test';
ROLLBACK;
```

Run via `mcp__supabase__execute_sql`. Expected: the second `INSERT` raises a check-constraint violation (`product_returns_condition_set_on_receipt`), confirming the constraint is live. The `ROLLBACK` means nothing persists.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260821_returns_exchanges_schema.sql
git commit -m "Add schema for returns, credit notes, and credit note applications"
```

---

### Task 2: `report_return` RPC

**Files:**
- Create: `supabase/migrations/20260821b_report_return_rpc.sql`

**Interfaces:**
- Consumes: `product_returns`, `invoice_line_items(id, invoice_id, quantity)`, `invoices(id, school_id, status)` from Task 1 / existing schema.
- Produces: `report_return(p_invoice_line_item_id uuid, p_quantity integer, p_reason_category text, p_reason_note text) RETURNS uuid` (the new return's id).

- [ ] **Step 1: Write the verification script and confirm it fails**

```sql
SELECT report_return(
  (SELECT id FROM invoice_line_items LIMIT 1), 1, 'wrong_item_shipped', 'test'
);
```

Run via `mcp__supabase__execute_sql`. Expected: `function report_return(...) does not exist`.

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Apply the migration**

Via `mcp__supabase__apply_migration`, `name: "20260821b_report_return_rpc"`.

- [ ] **Step 4: Re-run the verification and confirm success, then confirm the over-return guard**

```sql
-- Pick a real invoice_line_item_id and its quantity first:
SELECT id, quantity FROM invoice_line_items LIMIT 1;
-- Then, using that id and its quantity as v_qty:
SELECT report_return('<that id>', 1, 'wrong_item_shipped', 'verification test'); -- should return a uuid
SELECT report_return('<that id>', 999999, 'wrong_item_shipped', 'should fail'); -- should raise the over-return exception
DELETE FROM product_returns WHERE reason_note = 'verification test'; -- clean up
```

Run each via `mcp__supabase__execute_sql`. Expected: first call returns a uuid; second call raises "Return quantity exceeds..."; cleanup removes the test row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260821b_report_return_rpc.sql
git commit -m "Add report_return RPC"
```

---

### Task 3: `confirm_return_received` RPC

**Files:**
- Create: `supabase/migrations/20260821c_confirm_return_received_rpc.sql`

**Interfaces:**
- Consumes: `product_returns`, `invoice_line_items(product_id, unit_price, invoice_id)`, `invoices(school_id)`, `credit_notes`, `credit_note_fy_counters`, `products(stock_quantity)` — from Task 1 / existing schema. `report_return` from Task 2 (to create test data).
- Produces: `confirm_return_received(p_return_id uuid, p_condition text) RETURNS uuid` (the new credit note's id).

- [ ] **Step 1: Write the verification script and confirm it fails**

```sql
SELECT confirm_return_received((SELECT id FROM product_returns LIMIT 1), 'resellable');
```

Run via `mcp__supabase__execute_sql`. Expected: `function confirm_return_received(...) does not exist`.

- [ ] **Step 2: Write the migration**

```sql
CREATE OR REPLACE FUNCTION public.confirm_return_received(
  p_return_id uuid,
  p_condition text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
  v_unit_price numeric;
  v_invoice_id uuid;
  v_school_id uuid;
  v_credit_amount numeric;
  v_fy smallint;
  v_next integer;
  v_credit_note_id uuid;
  v_new_stock integer;
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

  SELECT status, quantity, invoice_line_item_id INTO v_status, v_quantity, v_line_item_id
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

  IF p_condition = 'resellable' THEN
    UPDATE products SET stock_quantity = stock_quantity + v_quantity
    WHERE id = v_product_id
    RETURNING stock_quantity INTO v_new_stock;
  END IF;

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
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_return_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_return_received(uuid, text) TO authenticated, service_role;
```

- [ ] **Step 3: Apply the migration**

Via `mcp__supabase__apply_migration`, `name: "20260821c_confirm_return_received_rpc"`.

- [ ] **Step 4: Re-run verification with real test data, covering both conditions**

```sql
-- Set up: a real invoice_line_item_id and its product's current stock.
SELECT ili.id AS line_item_id, ili.product_id, p.stock_quantity
FROM invoice_line_items ili JOIN products p ON p.id = ili.product_id LIMIT 1;

-- Report + confirm as resellable — stock should go up by 1, a credit note should exist.
SELECT report_return('<line_item_id>', 1, 'wrong_item_shipped', 'confirm-test-1');
SELECT confirm_return_received((SELECT id FROM product_returns WHERE reason_note = 'confirm-test-1'), 'resellable');
SELECT stock_quantity FROM products WHERE id = '<product_id>'; -- should be +1 vs the value read above
SELECT amount, credit_note_number FROM credit_notes cn JOIN product_returns pr ON pr.id = cn.source_return_id WHERE pr.reason_note = 'confirm-test-1';

-- Report + confirm as damaged — stock should NOT change, a credit note should still exist.
SELECT report_return('<line_item_id>', 1, 'damaged_in_transit', 'confirm-test-2');
SELECT confirm_return_received((SELECT id FROM product_returns WHERE reason_note = 'confirm-test-2'), 'damaged');
SELECT stock_quantity FROM products WHERE id = '<product_id>'; -- should be unchanged from the resellable check above

-- Re-confirming an already-received return should fail.
SELECT confirm_return_received((SELECT id FROM product_returns WHERE reason_note = 'confirm-test-1'), 'resellable'); -- should raise

-- Clean up.
DELETE FROM credit_notes WHERE source_return_id IN (SELECT id FROM product_returns WHERE reason_note LIKE 'confirm-test-%');
DELETE FROM product_returns WHERE reason_note LIKE 'confirm-test-%';
UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = '<product_id>'; -- undo the resellable restock
```

Run via `mcp__supabase__execute_sql`, substituting real ids. Expected: stock increments only for the resellable case, both mint a credit note with `amount = unit_price`, re-confirming raises "already been received."

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260821c_confirm_return_received_rpc.sql
git commit -m "Add confirm_return_received RPC"
```

---

### Task 4: Credit application on Manual Order Requests

**Files:**
- Create: `supabase/migrations/20260821d_credit_note_manual_order_integration.sql`

**Interfaces:**
- Consumes: `credit_notes_with_balance` (Task 1), existing `create_manual_product_order` (current body in `supabase/migrations/20260813_allow_out_of_stock_manual_orders.sql`) and `approve_order_items` (current body in `supabase/migrations/20260807e_book_order_requests_fulfillment_rpcs.sql`).
- Produces: `create_manual_product_order(..., p_credit_note_id uuid DEFAULT NULL, p_credit_amount numeric DEFAULT NULL)` — two new **trailing** optional params, existing call sites unaffected. `approve_order_items` unchanged signature, new side effect: writes a `credit_note_applications` row when the order it's invoicing carries an applied credit.

- [ ] **Step 1: Write the verification script and confirm it fails**

```sql
-- The credit params don't exist yet — this call should fail on an unknown parameter.
SELECT create_manual_product_order(
  (SELECT id FROM schools LIMIT 1), '[]'::jsonb, 0, 'UPI', current_date, NULL, NULL, NULL, NULL,
  gen_random_uuid(), 100
);
```

Run via `mcp__supabase__execute_sql`. Expected: error about the function's argument count/signature not matching (10 args vs. the current 9).

- [ ] **Step 2: Write the migration**

```sql
CREATE OR REPLACE FUNCTION public.create_manual_product_order(
  p_school_id uuid, p_items jsonb, p_payment_amount numeric, p_payment_mode text,
  p_payment_date date, p_payment_utr_reference text, p_payment_account_holder_name text,
  p_payment_screenshot_url text, p_notes text,
  p_credit_note_id uuid DEFAULT NULL, p_credit_amount numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_fy smallint;
  v_next integer;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_total numeric := 0;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found';
  END IF;
  IF p_payment_amount > 0 AND (p_payment_screenshot_url IS NULL OR trim(p_payment_screenshot_url) = '') THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF p_credit_note_id IS NOT NULL THEN
    IF p_credit_amount IS NULL OR p_credit_amount <= 0 THEN
      RAISE EXCEPTION 'Credit amount must be positive when a credit note is applied';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM credit_notes_with_balance
      WHERE id = p_credit_note_id AND school_id = p_school_id AND remaining_balance >= p_credit_amount
    ) THEN
      RAISE EXCEPTION 'Credit note does not belong to this school or has insufficient balance';
    END IF;
  END IF;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO product_order_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO product_orders (
    school_id, notes, payment_amount, payment_mode, payment_date,
    payment_utr_reference, payment_account_holder_name, payment_screenshot_url,
    order_number, fy, source, created_by,
    payment_status, confirmed_at, payment_reviewed_by, payment_reviewed_at,
    applied_credit_note_id, applied_credit_amount
  ) VALUES (
    p_school_id, p_notes, p_payment_amount, p_payment_mode, p_payment_date,
    p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url,
    v_next, v_fy, 'manual', auth.uid(),
    'confirmed', now(), auth.uid(), now(),
    p_credit_note_id, p_credit_amount
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive';
    END IF;

    SELECT unit_price INTO v_unit_price
    FROM products WHERE id = v_product_id AND is_active = true;
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Product not found or inactive';
    END IF;

    INSERT INTO product_order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  RETURN v_order_id;
END;
$function$;

-- Second change: approve_order_items records the credit application against
-- whichever invoice it creates first for an order that carries applied credit,
-- guarded by credit_applied_to_invoice so a later partial-approval on the same
-- order (a second invoice) never double-records it.
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

  IF v_credit_note_id IS NOT NULL AND NOT v_credit_already_applied THEN
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
    PERFORM pg_advisory_xact_lock(hashtext(v_credit_note_id::text));

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

  RETURN v_invoice_id;
END;
$$;
```

- [ ] **Step 3: Apply the migration**

Via `mcp__supabase__apply_migration`, `name: "20260821d_credit_note_manual_order_integration"`.

- [ ] **Step 4: Re-run verification — full loop with a real credit note**

```sql
-- Use the credit note minted in Task 3's Step 4 verification if it's still around,
-- or mint a fresh one: report_return + confirm_return_received against any real
-- invoice_line_item, then read its credit_notes_with_balance row.
SELECT id, school_id, remaining_balance FROM credit_notes_with_balance WHERE remaining_balance > 0 LIMIT 1;

-- Create a manual order for that same school, applying the full credit (net-zero case).
SELECT create_manual_product_order(
  '<school_id>',
  jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM products WHERE is_active LIMIT 1), 'quantity', 1)),
  0, 'UPI', current_date, NULL, NULL, NULL, 'credit-integration-test',
  '<credit_note_id>', '<remaining_balance>'
); -- should succeed with a NULL screenshot since payment_amount is 0

-- Confirm the order carries the applied credit.
SELECT applied_credit_note_id, applied_credit_amount, credit_applied_to_invoice FROM product_orders WHERE notes = 'credit-integration-test';

-- Approve its item and confirm a credit_note_applications row appears, and the
-- credit note's remaining_balance drops accordingly.
SELECT approve_order_items(
  (SELECT id FROM product_orders WHERE notes = 'credit-integration-test'),
  ARRAY(SELECT id FROM product_order_items WHERE order_id = (SELECT id FROM product_orders WHERE notes = 'credit-integration-test'))
);
SELECT * FROM credit_note_applications WHERE credit_note_id = '<credit_note_id>' AND application_type = 'invoice';
SELECT remaining_balance FROM credit_notes_with_balance WHERE id = '<credit_note_id>'; -- should now be 0 (or reduced)

-- Clean up test data (invoice, order items, order) as appropriate for the linked environment.
```

Run via `mcp__supabase__execute_sql`, substituting real ids. Expected: order creation succeeds with no screenshot, `credit_applied_to_invoice` flips to `true` after approval, exactly one `credit_note_applications` row is written, and the balance reflects it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260821d_credit_note_manual_order_integration.sql
git commit -m "Wire credit note application into Manual Order Requests and approval"
```

---

### Task 5: `issue_credit_refund` RPC

**Files:**
- Create: `supabase/migrations/20260821e_issue_credit_refund_rpc.sql`

**Interfaces:**
- Consumes: `credit_notes_with_balance`, `credit_note_applications` (Task 1).
- Produces: `issue_credit_refund(p_credit_note_id uuid, p_amount numeric, p_refund_mode text, p_refund_reference text, p_note text) RETURNS uuid` (the new application row's id).

- [ ] **Step 1: Write the verification script and confirm it fails**

```sql
SELECT issue_credit_refund((SELECT id FROM credit_notes LIMIT 1), 10, 'Bank Transfer', 'TESTREF', 'test');
```

Run via `mcp__supabase__execute_sql`. Expected: `function issue_credit_refund(...) does not exist`.

- [ ] **Step 2: Write the migration**

```sql
CREATE OR REPLACE FUNCTION public.issue_credit_refund(
  p_credit_note_id uuid,
  p_amount numeric,
  p_refund_mode text,
  p_refund_reference text,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_application_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive';
  END IF;
  IF p_refund_mode IS NULL OR trim(p_refund_mode) = '' THEN
    RAISE EXCEPTION 'Refund mode is required';
  END IF;

  SELECT remaining_balance INTO v_balance
  FROM credit_notes_with_balance WHERE id = p_credit_note_id;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Refund amount (%) exceeds remaining credit balance (%)', p_amount, v_balance;
  END IF;

  INSERT INTO credit_note_applications (credit_note_id, application_type, amount, refund_mode, refund_reference, note, recorded_by)
  VALUES (p_credit_note_id, 'refund', p_amount, trim(p_refund_mode), NULLIF(trim(p_refund_reference), ''), NULLIF(trim(p_note), ''), auth.uid())
  RETURNING id INTO v_application_id;

  RETURN v_application_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_credit_refund(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_refund(uuid, numeric, text, text, text) TO authenticated, service_role;
```

- [ ] **Step 3: Apply the migration**

Via `mcp__supabase__apply_migration`, `name: "20260821e_issue_credit_refund_rpc"`.

- [ ] **Step 4: Re-run verification — partial refund, then over-refund guard**

```sql
SELECT id, remaining_balance FROM credit_notes_with_balance WHERE remaining_balance > 0 LIMIT 1;

-- Partial refund of half the balance.
SELECT issue_credit_refund('<credit_note_id>', '<half of remaining_balance>', 'Bank Transfer', 'TESTREF123', 'verification');
SELECT remaining_balance FROM credit_notes_with_balance WHERE id = '<credit_note_id>'; -- should be exactly half of what it was

-- Attempting to refund more than what's left should fail.
SELECT issue_credit_refund('<credit_note_id>', '<remaining_balance + 1>', 'Bank Transfer', 'TESTREF456', 'should fail'); -- should raise

-- Clean up.
DELETE FROM credit_note_applications WHERE note = 'verification';
```

Run via `mcp__supabase__execute_sql`. Expected: partial refund succeeds and balance drops accordingly, over-refund raises the specific exception, cleanup restores the balance.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260821e_issue_credit_refund_rpc.sql
git commit -m "Add issue_credit_refund RPC"
```

---

### Task 6: Report Return — UI on Invoice detail

**Files:**
- Create: `src/components/sales/ReportReturnDialog.tsx`
- Modify: `src/components/sales/InvoiceItemsDialog.tsx`

**Interfaces:**
- Consumes: `report_return` RPC (Task 2). `invoice_line_items(id, item_name, quantity, unit_price, line_total, product_id, invoice_id)`, `invoices(school_id)`, `product_returns(invoice_line_item_id, quantity)` tables.
- Produces: `ReportReturnDialog` component with props `{ open: boolean; onOpenChange: (open: boolean) => void; lineItem: { id: string; item_name: string; maxReturnable: number } | null; onReported: () => void }` — reused by no other task in this plan, but is the pattern later tasks' dialogs (Task 7, Task 8) follow.

- [ ] **Step 1: Write `ReportReturnDialog.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const REASON_OPTIONS = [
  { value: 'wrong_item_shipped', label: 'Wrong item shipped' },
  { value: 'wrong_item_ordered_by_staff', label: 'Staff entered the wrong item' },
  { value: 'damaged_in_transit', label: 'Damaged in transit' },
  { value: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItem: { id: string; item_name: string; maxReturnable: number } | null;
  onReported: () => void;
}

export default function ReportReturnDialog({ open, onOpenChange, lineItem, onReported }: Props) {
  const { toast } = useToast();
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('wrong_item_shipped');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setQuantity('1'); setReason('wrong_item_shipped'); setNote(''); }
  }, [open, lineItem?.id]);

  const qtyNum = parseInt(quantity, 10);
  const canSave = !!lineItem && qtyNum > 0 && qtyNum <= lineItem.maxReturnable;

  const handleSave = async () => {
    if (!canSave || !lineItem) return;
    setSaving(true);
    const { error } = await supabase.rpc('report_return' as any, {
      p_invoice_line_item_id: lineItem.id,
      p_quantity: qtyNum,
      p_reason_category: reason,
      p_reason_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Return reported' });
    onReported();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Report Return{lineItem ? ` — ${lineItem.item_name}` : ''}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Quantity returning</Label>
            <Input type="number" min={1} max={lineItem?.maxReturnable ?? 1} value={quantity}
              onChange={e => setQuantity(e.target.value)} />
            {lineItem && (
              <p className="text-xs text-muted-foreground mt-1">
                Up to {lineItem.maxReturnable} of this line can still be returned.
              </p>
            )}
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Report Return'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Modify `InvoiceItemsDialog.tsx`** to fetch line item ids/product ids, the invoice's `school_id`, and existing returns, and wire in the button + dialog

Replace the full file content with:

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import ReportReturnDialog from './ReportReturnDialog';

type LineItem = { id: string; item_name: string; quantity: number; unit_price: number; line_total: number };

export default function InvoiceItemsDialog({
  invoiceId,
  onOpenChange,
}: {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSchoolBilled, setIsSchoolBilled] = useState(false);
  const [returnedByLine, setReturnedByLine] = useState<Record<string, number>>({});
  const [returnTarget, setReturnTarget] = useState<{ id: string; item_name: string; maxReturnable: number } | null>(null);

  const loadReturned = async (lineIds: string[]) => {
    if (lineIds.length === 0) { setReturnedByLine({}); return; }
    const { data } = await supabase
      .from('product_returns' as any)
      .select('invoice_line_item_id, quantity')
      .in('invoice_line_item_id', lineIds);
    const totals: Record<string, number> = {};
    for (const row of (data || []) as unknown as { invoice_line_item_id: string; quantity: number }[]) {
      totals[row.invoice_line_item_id] = (totals[row.invoice_line_item_id] || 0) + row.quantity;
    }
    setReturnedByLine(totals);
  };

  const load = () => {
    if (!invoiceId) return;
    setLoading(true);
    Promise.all([
      supabase.from('invoice_line_items' as any).select('id, item_name, quantity, unit_price, line_total')
        .eq('invoice_id', invoiceId).order('row_order'),
      supabase.from('invoices' as any).select('school_id').eq('id', invoiceId).single(),
    ]).then(([itemsRes, invoiceRes]) => {
      const rows = (itemsRes.data || []) as unknown as LineItem[];
      setItems(rows);
      setIsSchoolBilled(!!(invoiceRes.data as unknown as { school_id: string | null } | null)?.school_id);
      setLoading(false);
      loadReturned(rows.map(r => r.id));
    });
  };

  useEffect(() => { load(); }, [invoiceId]);

  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <Dialog open={!!invoiceId} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invoiced Items</DialogTitle></DialogHeader>
        {!loading && items.length > 0 && (
          <p className="text-sm text-muted-foreground -mt-2">Total Quantity: <span className="font-semibold text-foreground">{totalQty}</span></p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Amount</TableHead>
              {isSchoolBilled && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No items.</TableCell></TableRow>
            ) : (
              items.map((it) => {
                const maxReturnable = it.quantity - (returnedByLine[it.id] || 0);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.item_name}</TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell>₹{it.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>₹{it.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    {isSchoolBilled && (
                      <TableCell>
                        {maxReturnable > 0 && (
                          <Button variant="outline" size="sm"
                            onClick={() => setReturnTarget({ id: it.id, item_name: it.item_name, maxReturnable })}>
                            Report Return
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DialogContent>
      <ReportReturnDialog
        open={!!returnTarget}
        onOpenChange={(o) => { if (!o) setReturnTarget(null); }}
        lineItem={returnTarget}
        onReported={load}
      />
    </Dialog>
  );
}
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm no new errors**

Run: `npx tsc --noEmit`
Expected: no errors originating from `InvoiceItemsDialog.tsx` or `ReportReturnDialog.tsx`.

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev`), sign in, open Sales → Invoices, click any school-billed invoice number to open the Invoiced Items popup. Confirm: a "Report Return" button appears next to each line item; clicking it opens the dialog pre-titled with the item name; setting quantity above the line's total raises the HTML5 max validation; submitting with a valid quantity closes the dialog, shows the "Return reported" toast, and the button's available quantity (shown on re-opening) reflects the reduction. Open a prospect-billed invoice (if one exists) and confirm no "Report Return" column/button appears at all.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/ReportReturnDialog.tsx src/components/sales/InvoiceItemsDialog.tsx
git commit -m "Add Report Return action to Invoice detail"
```

---

### Task 7: Returns queue page

**Files:**
- Create: `src/pages/Sales/ReturnsPage.tsx`
- Create: `src/components/sales/ConfirmReturnReceiptDialog.tsx`
- Modify: `src/App.tsx` (add route)

**Interfaces:**
- Consumes: `confirm_return_received` RPC (Task 3). `product_returns` joined to `invoice_line_items` → `invoices` → `schools` for display.
- Produces: page at `/sales/returns`; no exports consumed by other tasks (Task 8 adds the nav entry alongside its own page, see Task 8 Step 4).

- [ ] **Step 1: Write `ConfirmReturnReceiptDialog.tsx`**

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string | null;
  itemName: string;
  onConfirmed: () => void;
}

export default function ConfirmReturnReceiptDialog({ open, onOpenChange, returnId, itemName, onConfirmed }: Props) {
  const { toast } = useToast();
  const [condition, setCondition] = useState<'resellable' | 'damaged' | ''>('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!returnId || !condition) return;
    setSaving(true);
    const { error } = await supabase.rpc('confirm_return_received' as any, {
      p_return_id: returnId,
      p_condition: condition,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Return received, credit note issued' });
    setCondition('');
    onConfirmed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Confirm Receipt — {itemName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label>Condition on receipt</Label>
          <RadioGroup value={condition} onValueChange={(v) => setCondition(v as 'resellable' | 'damaged')}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="resellable" id="cond-resellable" />
              <Label htmlFor="cond-resellable" className="font-normal">Resellable — add back to stock</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="damaged" id="cond-damaged" />
              <Label htmlFor="cond-damaged" className="font-normal">Damaged — write off, do not restock</Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!condition || saving}>{saving ? 'Saving…' : 'Confirm Receipt'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `ReturnsPage.tsx`**

```tsx
import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ConfirmReturnReceiptDialog from '@/components/sales/ConfirmReturnReceiptDialog';

type ReturnRow = {
  id: string;
  quantity: number;
  reason_category: string;
  reason_note: string | null;
  status: 'requested' | 'received';
  condition_on_receipt: 'resellable' | 'damaged' | null;
  requested_at: string;
  invoice_line_items: {
    item_name: string;
    invoices: { invoice_number: number | null; fy: number | null; schools: { school_name: string; ss_no: number | null } | null } | null;
  } | null;
};

const REASON_LABELS: Record<string, string> = {
  wrong_item_shipped: 'Wrong item shipped',
  wrong_item_ordered_by_staff: 'Staff entered wrong item',
  damaged_in_transit: 'Damaged in transit',
  other: 'Other',
};

export default function ReturnsPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; itemName: string } | null>(null);

  const load = () => {
    setLoading(true);
    supabase
      .from('product_returns' as any)
      .select(`
        id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
        invoice_line_items ( item_name, invoices ( invoice_number, fy, schools ( school_name, ss_no ) ) )
      `)
      .order('requested_at', { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as unknown as ReturnRow[]);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const requested = rows.filter(r => r.status === 'requested');
  const received = rows.filter(r => r.status === 'received');

  const invoiceLabel = (r: ReturnRow) => {
    const inv = r.invoice_line_items?.invoices;
    if (!inv?.invoice_number) return '—';
    return `INV/${inv.fy}-${(inv.fy ?? 0) + 1}/${inv.invoice_number}`;
  };
  const schoolLabel = (r: ReturnRow) => {
    const school = r.invoice_line_items?.invoices?.schools;
    return school ? `${school.school_name}${school.ss_no != null ? ` (SS #${school.ss_no})` : ''}` : '—';
  };

  const renderRows = (list: ReturnRow[], showAction: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Invoice</TableHead>
          {!showAction && <TableHead>Condition</TableHead>}
          {showAction && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
        ) : list.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Nothing here.</TableCell></TableRow>
        ) : (
          list.map(r => (
            <TableRow key={r.id}>
              <TableCell>{schoolLabel(r)}</TableCell>
              <TableCell>{r.invoice_line_items?.item_name ?? '—'}</TableCell>
              <TableCell>{r.quantity}</TableCell>
              <TableCell><Badge variant="outline">{REASON_LABELS[r.reason_category] ?? r.reason_category}</Badge></TableCell>
              <TableCell>{invoiceLabel(r)}</TableCell>
              {!showAction && <TableCell className="capitalize">{r.condition_on_receipt}</TableCell>}
              {showAction && (
                <TableCell>
                  {canManage && (
                    <Button size="sm" onClick={() => setConfirmTarget({ id: r.id, itemName: r.invoice_line_items?.item_name ?? 'item' })}>
                      Confirm Receipt
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Returns</h1>
        <Tabs defaultValue="requested">
          <TabsList>
            <TabsTrigger value="requested">Requested ({requested.length})</TabsTrigger>
            <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="requested">{renderRows(requested, true)}</TabsContent>
          <TabsContent value="received">{renderRows(received, false)}</TabsContent>
        </Tabs>
      </div>
      <ConfirmReturnReceiptDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        returnId={confirmTarget?.id ?? null}
        itemName={confirmTarget?.itemName ?? ''}
        onConfirmed={load}
      />
    </SalesLayout>
  );
}
```

- [ ] **Step 3: Add the route in `src/App.tsx`**

Find this line (existing, in the `/sales/*` route block):

```tsx
        <Route path="/sales/purchase-report" element={<ProtectedRoute><PurchaseReportPage /></ProtectedRoute>} />
```

Add immediately after it:

```tsx
        <Route path="/sales/returns" element={<ProtectedRoute><ReturnsPage /></ProtectedRoute>} />
```

And add the import near the other `Sales/*Page` imports at the top of the file:

```tsx
import ReturnsPage from '@/pages/Sales/ReturnsPage';
```

- [ ] **Step 4: Run `tsc --noEmit` and confirm no new errors**

Run: `npx tsc --noEmit`
Expected: no errors from `ReturnsPage.tsx`, `ConfirmReturnReceiptDialog.tsx`, or `App.tsx`.

- [ ] **Step 5: Manual verification**

Start the dev server, sign in as superadmin, navigate directly to `/sales/returns`. Confirm the Requested tab shows any return reported in Task 6's manual test with a "Confirm Receipt" button; click it, pick Resellable, confirm — the row should move to the Received tab showing "resellable" as its condition, and the toast should read "Return received, credit note issued." Sign in as a non-superadmin/accountant role (if available) and confirm the "Confirm Receipt" button doesn't render for that role.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/ReturnsPage.tsx src/components/sales/ConfirmReturnReceiptDialog.tsx src/App.tsx
git commit -m "Add Returns queue page"
```

---

### Task 8: Credit Notes page + Returns nav group

**Files:**
- Create: `src/pages/Sales/CreditNotesPage.tsx`
- Create: `src/components/sales/IssueRefundDialog.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/sales/SalesLayout.tsx` (add "Returns" dropdown group with both new pages)

**Interfaces:**
- Consumes: `issue_credit_refund` RPC (Task 5). `credit_notes_with_balance` view, `credit_note_applications` table (Task 1). Both linked into the nav alongside `ReturnsPage` (Task 7).
- Produces: page at `/sales/credit-notes`; both pages reachable from the Sales nav.

- [ ] **Step 1: Write `IssueRefundDialog.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const REFUND_MODES = ['Bank Transfer', 'UPI', 'Cash'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditNote: { id: string; remaining_balance: number; school_name: string } | null;
  onIssued: () => void;
}

export default function IssueRefundDialog({ open, onOpenChange, creditNote, onIssued }: Props) {
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(REFUND_MODES[0]);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && creditNote) { setAmount(String(creditNote.remaining_balance)); setMode(REFUND_MODES[0]); setReference(''); setNote(''); }
  }, [open, creditNote?.id]);

  const amountNum = parseFloat(amount);
  const canSave = !!creditNote && amountNum > 0 && amountNum <= creditNote.remaining_balance;

  const handleSave = async () => {
    if (!canSave || !creditNote) return;
    setSaving(true);
    const { error } = await supabase.rpc('issue_credit_refund' as any, {
      p_credit_note_id: creditNote.id,
      p_amount: amountNum,
      p_refund_mode: mode,
      p_refund_reference: reference.trim() || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Refund recorded' });
    onIssued();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Issue Refund{creditNote ? ` — ${creditNote.school_name}` : ''}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Amount (max ₹{creditNote?.remaining_balance.toLocaleString('en-IN')})</Label>
            <Input type="number" min={0.01} max={creditNote?.remaining_balance} step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Mode</Label>
            <select className="w-full border rounded-md h-9 px-3 text-sm" value={mode} onChange={e => setMode(e.target.value)}>
              {REFUND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR / transaction id" />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Issue Refund'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `CreditNotesPage.tsx`**

```tsx
import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import IssueRefundDialog from '@/components/sales/IssueRefundDialog';

type OpenCreditRow = {
  id: string;
  credit_note_number: number | null;
  fy: number | null;
  amount: number;
  remaining_balance: number;
  schools: { school_name: string; ss_no: number | null } | null;
};

type RefundHistoryRow = {
  id: string;
  amount: number;
  refund_mode: string | null;
  refund_reference: string | null;
  recorded_at: string;
  credit_notes: { credit_note_number: number | null; fy: number | null; schools: { school_name: string } | null } | null;
};

export default function CreditNotesPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [openCredits, setOpenCredits] = useState<OpenCreditRow[]>([]);
  const [history, setHistory] = useState<RefundHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<{ id: string; remaining_balance: number; school_name: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from('credit_notes_with_balance' as any)
        .select('id, credit_note_number, fy, amount, remaining_balance, schools ( school_name, ss_no )')
        .gt('remaining_balance', 0)
        .order('fy', { ascending: false }).order('credit_note_number', { ascending: false }),
      supabase.from('credit_note_applications' as any)
        .select('id, amount, refund_mode, refund_reference, recorded_at, credit_notes ( credit_note_number, fy, schools ( school_name ) )')
        .eq('application_type', 'refund')
        .order('recorded_at', { ascending: false }),
    ]).then(([openRes, historyRes]) => {
      setOpenCredits((openRes.data || []) as unknown as OpenCreditRow[]);
      setHistory((historyRes.data || []) as unknown as RefundHistoryRow[]);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const cnLabel = (num: number | null, fy: number | null) => num ? `CN/${fy}-${(fy ?? 0) + 1}/${num}` : '—';

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Credit Notes</h1>
        <Tabs defaultValue="open">
          <TabsList>
            <TabsTrigger value="open">Open ({openCredits.length})</TabsTrigger>
            <TabsTrigger value="history">Refund History ({history.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="open">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : openCredits.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No open credit.</TableCell></TableRow>
                ) : (
                  openCredits.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{cnLabel(c.credit_note_number, c.fy)}</TableCell>
                      <TableCell>{c.schools?.school_name ?? '—'}{c.schools?.ss_no != null ? ` (SS #${c.schools.ss_no})` : ''}</TableCell>
                      <TableCell>₹{c.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="font-semibold">₹{c.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        {canManage && (
                          <Button size="sm" variant="outline" onClick={() => setRefundTarget({
                            id: c.id, remaining_balance: c.remaining_balance, school_name: c.schools?.school_name ?? 'School',
                          })}>
                            Issue Refund
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="history">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : history.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No refunds issued yet.</TableCell></TableRow>
                ) : (
                  history.map(h => (
                    <TableRow key={h.id}>
                      <TableCell>{cnLabel(h.credit_notes?.credit_note_number ?? null, h.credit_notes?.fy ?? null)}</TableCell>
                      <TableCell>{h.credit_notes?.schools?.school_name ?? '—'}</TableCell>
                      <TableCell>₹{h.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{h.refund_mode}</TableCell>
                      <TableCell>{h.refund_reference ?? '—'}</TableCell>
                      <TableCell>{new Date(h.recorded_at).toLocaleDateString('en-IN')}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </div>
      <IssueRefundDialog
        open={!!refundTarget}
        onOpenChange={(o) => { if (!o) setRefundTarget(null); }}
        creditNote={refundTarget}
        onIssued={load}
      />
    </SalesLayout>
  );
}
```

- [ ] **Step 3: Add the route in `src/App.tsx`**

Add after the `/sales/returns` route added in Task 7:

```tsx
        <Route path="/sales/credit-notes" element={<ProtectedRoute><CreditNotesPage /></ProtectedRoute>} />
```

And its import:

```tsx
import CreditNotesPage from '@/pages/Sales/CreditNotesPage';
```

- [ ] **Step 4: Add the "Returns" nav group in `src/components/sales/SalesLayout.tsx`**

In the icon import line near the top:

```tsx
import { LogOut, ArrowLeft, ChevronDown, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown, BarChart3, FileBarChart, PackageSearch, TrendingUp, RotateCcw, Wallet } from 'lucide-react';
```

Immediately after the closing `]` of the existing `navGroups` array's `Reports` entry, add a new group:

```tsx
  {
    label: 'Returns',
    items: [
      { label: 'Returns', href: '/sales/returns', icon: RotateCcw },
      { label: 'Credit Notes', href: '/sales/credit-notes', icon: Wallet },
    ],
  },
```

Add a badge hook mirroring `useOrderRequestsBadge`, right after that function's definition, so unconfirmed returns don't silently sit unnoticed:

```tsx
function useReturnsBadge() {
  return useQuery({
    queryKey: ['sales-returns-badge'],
    queryFn: async () => {
      const { count } = await supabase.from('product_returns' as any).select('*', { count: 'exact', head: true }).eq('status', 'requested');
      return count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
}
```

In the `SalesLayout` component body, alongside `const { data: orderRequestsBadge = 0 } = useOrderRequestsBadge();`, add:

```tsx
  const { data: returnsBadge = 0 } = useReturnsBadge();
```

In the `navGroups.map` render block, inside the `DropdownMenuContent`, badge the Returns item specifically — replace:

```tsx
                        {group.items.map(({ label, href, icon: Icon }) => (
                          <DropdownMenuItem key={href} asChild>
                            <Link
                              to={href}
                              className={`flex items-center gap-2 w-full ${
                                location.pathname === href ? 'bg-accent text-accent-foreground' : ''
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </Link>
                          </DropdownMenuItem>
                        ))}
```

with:

```tsx
                        {group.items.map(({ label, href, icon: Icon }) => (
                          <DropdownMenuItem key={href} asChild>
                            <Link
                              to={href}
                              className={`flex items-center gap-2 w-full ${
                                location.pathname === href ? 'bg-accent text-accent-foreground' : ''
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                              {href === '/sales/returns' && returnsBadge > 0 && (
                                <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none">
                                  {returnsBadge > 99 ? '99+' : returnsBadge}
                                </span>
                              )}
                            </Link>
                          </DropdownMenuItem>
                        ))}
```

- [ ] **Step 5: Run `tsc --noEmit` and confirm no new errors**

Run: `npx tsc --noEmit`
Expected: no errors from `CreditNotesPage.tsx`, `IssueRefundDialog.tsx`, `SalesLayout.tsx`, or `App.tsx`.

- [ ] **Step 6: Manual verification**

Start the dev server, sign in as superadmin. Confirm the nav now shows a "Returns" dropdown with "Returns" and "Credit Notes" entries, and the "Returns" entry carries a badge matching the count of Requested returns. Navigate to Credit Notes → Open tab; confirm the credit note minted during Task 3/7's manual testing appears with its correct remaining balance. Click "Issue Refund", submit a partial amount, confirm the row's remaining balance updates and the Refund History tab shows the new entry with mode/reference/date. Attempt to type an amount above the remaining balance and confirm the Issue Refund button stays disabled.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Sales/CreditNotesPage.tsx src/components/sales/IssueRefundDialog.tsx src/App.tsx src/components/sales/SalesLayout.tsx
git commit -m "Add Credit Notes page and Returns nav group"
```

---

### Task 9: Apply credit on Manual Order Request

**Files:**
- Modify: `src/pages/Sales/ManualOrderDialog.tsx`

**Interfaces:**
- Consumes: extended `create_manual_product_order` (Task 4), `credit_notes_with_balance` view (Task 1).
- Produces: no new exports — this is a leaf UI change.

- [ ] **Step 1: Add credit-balance lookup and apply-credit state**

In `ManualOrderDialog.tsx`, add a new state block near the existing `amount`/`payDate` state declarations:

```tsx
  const [availableCredit, setAvailableCredit] = useState<{ id: string; remaining_balance: number } | null>(null);
  const [applyCredit, setApplyCredit] = useState('');
```

Add an effect that looks up the school's open credit whenever a school is selected — place it right after the existing `useEffect(() => { ... }, [open]);` block:

```tsx
  useEffect(() => {
    if (!selectedSchool) { setAvailableCredit(null); setApplyCredit(''); return; }
    supabase.from('credit_notes_with_balance' as any)
      .select('id, remaining_balance')
      .eq('school_id', selectedSchool.id)
      .gt('remaining_balance', 0)
      .order('remaining_balance', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const row = (data?.[0] ?? null) as unknown as { id: string; remaining_balance: number } | null;
        setAvailableCredit(row);
        setApplyCredit('');
      });
  }, [selectedSchool?.id]);
```

- [ ] **Step 2: Compute net amount due and relax the save/screenshot requirement**

Replace the existing `canSave` definition:

```tsx
  const canSave = !!selectedSchool
    && lineItems.length > 0
    && lineItems.every(l => l.product_id && l.quantity > 0)
    && amount.trim() && parseFloat(amount) > 0
    && payDate && payMode && !!file;
```

with:

```tsx
  const creditToApply = availableCredit ? Math.min(parseFloat(applyCredit) || 0, availableCredit.remaining_balance, cartTotal) : 0;
  const netDue = Math.max(cartTotal - creditToApply, 0);

  const canSave = !!selectedSchool
    && lineItems.length > 0
    && lineItems.every(l => l.product_id && l.quantity > 0)
    && payDate && payMode
    && (netDue === 0 ? true : (amount.trim() && parseFloat(amount) > 0 && !!file));
```

- [ ] **Step 3: Send the credit params and skip the upload when net-zero**

Replace the start of `handleSave` (the `if (!canSave...)` guard through the upload block):

```tsx
  const handleSave = async () => {
    if (!canSave || !selectedSchool) {
      toast({ title: 'Fill in all required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const ext = file.name.split('.').pop();
    const path = `${selectedSchool.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: true });
    if (upErr) {
      setSaving(false);
      toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
      return;
    }
    const { data: signedData } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 63072000);
    const screenshotUrl = signedData?.signedUrl ?? null;
    if (!screenshotUrl) {
      setSaving(false);
      toast({ title: 'Failed to prepare the uploaded file', variant: 'destructive' });
      return;
    }
```

with:

```tsx
  const handleSave = async () => {
    if (!canSave || !selectedSchool) {
      toast({ title: 'Fill in all required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    let screenshotUrl: string | null = null;
    if (netDue > 0) {
      if (!file) { setSaving(false); toast({ title: 'Payment proof is required', variant: 'destructive' }); return; }
      const ext = file.name.split('.').pop();
      const path = `${selectedSchool.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: true });
      if (upErr) {
        setSaving(false);
        toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
        return;
      }
      const { data: signedData } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 63072000);
      screenshotUrl = signedData?.signedUrl ?? null;
      if (!screenshotUrl) {
        setSaving(false);
        toast({ title: 'Failed to prepare the uploaded file', variant: 'destructive' });
        return;
      }
    }
```

Then update the RPC call — replace:

```tsx
    const items = lineItems.map(l => ({ product_id: l.product_id, quantity: l.quantity }));
    const { data, error } = await supabase.rpc('create_manual_product_order' as any, {
      p_school_id: selectedSchool.id,
      p_items: items,
      p_payment_amount: parseFloat(amount),
      p_payment_mode: payMode,
      p_payment_date: payDate,
      p_payment_utr_reference: utr.trim() || null,
      p_payment_account_holder_name: accountHolderName.trim() || null,
      p_payment_screenshot_url: screenshotUrl,
      p_notes: notes.trim() || null,
    });
```

with:

```tsx
    const items = lineItems.map(l => ({ product_id: l.product_id, quantity: l.quantity }));
    const { data, error } = await supabase.rpc('create_manual_product_order' as any, {
      p_school_id: selectedSchool.id,
      p_items: items,
      p_payment_amount: netDue,
      p_payment_mode: payMode,
      p_payment_date: payDate,
      p_payment_utr_reference: utr.trim() || null,
      p_payment_account_holder_name: accountHolderName.trim() || null,
      p_payment_screenshot_url: screenshotUrl,
      p_notes: notes.trim() || null,
      p_credit_note_id: creditToApply > 0 ? availableCredit?.id ?? null : null,
      p_credit_amount: creditToApply > 0 ? creditToApply : null,
    });
```

- [ ] **Step 4: Show the credit balance and apply-credit input in the form**

In the JSX, immediately before the payment-amount `<Input>` field (the block rendering `<Label>Amount Paid</Label>` or equivalent — the existing amount field just above the payment-mode select), add:

```tsx
          {availableCredit && (
            <div className="border rounded-md p-3 bg-emerald-50 space-y-2">
              <p className="text-sm font-medium text-emerald-800">
                This school has ₹{availableCredit.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} open credit.
              </p>
              <div>
                <Label>Apply credit</Label>
                <Input type="number" min={0} max={Math.min(availableCredit.remaining_balance, cartTotal)} step="0.01"
                  value={applyCredit} onChange={e => setApplyCredit(e.target.value)} placeholder="0.00" />
              </div>
              <p className="text-sm text-muted-foreground">
                Net amount due: <span className="font-semibold text-foreground">₹{netDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </p>
            </div>
          )}
```

Immediately after that (or after the existing amount field if `availableCredit` is null), make the existing Amount Paid input and file upload conditionally required in their labels — find the amount field's `<Label>` (reads something like `<Label>Amount Paid</Label>`) and change it to:

```tsx
          <Label>Amount Paid{netDue === 0 ? ' (fully covered by credit)' : ''}</Label>
```

And find the payment-screenshot upload section's label (reads something like `<Label>Payment Screenshot</Label>`) and change it to:

```tsx
          <Label>Payment Screenshot{netDue === 0 ? ' (not required — fully covered by credit)' : ''}</Label>
```

- [ ] **Step 5: Run `tsc --noEmit` and confirm no new errors**

Run: `npx tsc --noEmit`
Expected: no errors from `ManualOrderDialog.tsx`.

- [ ] **Step 6: Manual verification**

Using the school and credit note from Task 3/7/8's manual testing (or create a fresh return → confirm receipt → credit note for a test school), open Sales → Order Requests → New Manual Order, select that school. Confirm the green credit banner appears showing the correct remaining balance. Add a line item whose price is less than the credit — apply the full credit, confirm "Net amount due" shows ₹0, confirm the Amount Paid/Screenshot fields relabel as not required, and confirm the order can be saved without selecting a file. Then repeat with a line item priced higher than the remaining credit — confirm the net-due amount is correctly reduced (not zeroed), and confirm the screenshot is still required to save. Finally, in the database, verify the resulting `product_orders` row has `applied_credit_note_id`/`applied_credit_amount` set, and that approving its item(s) (via Order Requests detail) produces a `credit_note_applications` row and drops the credit note's `remaining_balance` in Credit Notes → Open.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Sales/ManualOrderDialog.tsx
git commit -m "Apply credit notes when creating a Manual Order Request"
```

---

## Self-Review Notes

**Spec coverage:** reason categories (Task 2), quantity-scoped over-return guard (Task 2), condition-required-every-time + atomic stock restore (Task 3), per-FY credit note numbering (Task 3), never-mutate-original-invoice (all tasks — no task touches `invoices`/`invoice_line_items` UPDATE), credit application math (net-equal/partial/leftover — Task 9's `creditToApply`/`netDue` computation), refund with partial support (Task 5), Open + Refund History views (Task 8), prospect-exclusion (Task 2's school_id check, Task 6's `isSchoolBilled` gate), role gating (Task 3/5 backend, Task 7/8 frontend `canManage`), excess/unbilled quantity explicitly out of scope (no task builds it) — all covered.

**Type consistency checked:** `report_return`/`confirm_return_received`/`issue_credit_refund` signatures match between their RPC definition (Tasks 2/3/5) and every `supabase.rpc(...)` call site (Tasks 6/7/8). `create_manual_product_order`'s two new trailing params match between Task 4's definition and Task 9's call site. `credit_notes_with_balance.remaining_balance` is read consistently as a `number` field across Tasks 8 and 9.
