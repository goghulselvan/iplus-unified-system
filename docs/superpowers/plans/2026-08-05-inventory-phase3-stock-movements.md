# Inventory Module — Phase 3: Stock Movements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual stock-in (outside a purchase order) and a reversible +/- stock correction tool to the Sales module's inventory — the third of 6 phases (see `docs/superpowers/specs/2026-08-04-inventory-module-rebuild-design.md`).

**Architecture:** Two new tables (`inventory_stock_adds`, `inventory_stock_adjustments`) plus 3 SECURITY DEFINER RPCs (`add_stock`, `create_stock_adjustment`, `delete_stock_adjustment` — the last one reverses the adjustment's effect on stock before deleting it), all mirroring `create_invoice`/`create_purchase_order`'s proven pattern. One new combined page for both stock-movement types, since they're closely related concepts a staff member would look for together.

**Tech Stack:** React + TypeScript + Vite, shadcn/ui, Supabase (Postgres + supabase-js + RPCs), Supabase CLI (`db query --linked --file`).

## Global Constraints

- Never use `supabase db push` — apply with `supabase db query --linked --file <path>`, register in `supabase_migrations.schema_migrations`.
- RLS: `is_crm_user()`, matching every table in this CRM.
- No test framework — verify via `npx tsc --noEmit` + `npm run build` + direct SQL smoke tests with before/after/cleanup discipline (record real product stock values before any test, restore exactly after).
- RPC style must match `create_invoice`/`create_purchase_order` exactly: SECURITY DEFINER, `SET search_path = public`, `is_crm_user()` check first, `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated, service_role`.
- A stock adjustment must never be allowed to drive `stock_quantity` negative (reject with a clear error, matching the reference ERP's `StockAdjustmentController` behavior: "This adjustment would make stock negative"). This applies both to creating an adjustment AND to deleting/reversing one (reversing a positive adjustment could also drive stock negative if stock was since sold down).
- `inventory_stock_adds` is insert-only (no delete/reversal — a stock-add "mistake" is corrected via a stock *adjustment*, not by deleting the add record, to keep one clear audit trail mechanism rather than two).

---

### Task 1: Migration — 2 tables + 3 RPCs

**Files:**
- Create: `supabase/migrations/20260807_inventory_phase3_stock_movements.sql`

**Interfaces:**
- Produces: `inventory_stock_adds(id, product_id, quantity, reason, added_by, added_date, created_at)`; `inventory_stock_adjustments(id, product_id, quantity_delta, reason, adjusted_by, adjusted_date, created_at)`; `add_stock(p_product_id uuid, p_quantity integer, p_reason text) RETURNS jsonb` (returns `{id, new_stock_quantity}`); `create_stock_adjustment(p_product_id uuid, p_quantity_delta integer, p_reason text) RETURNS jsonb` (returns `{id, new_stock_quantity}`, rejects if it would go negative); `delete_stock_adjustment(p_adjustment_id uuid) RETURNS jsonb` (reverses the delta then deletes the row, rejects if the reversal would go negative).

- [ ] **Step 1: Write the migration file**

```sql
-- Phase 3 of inventory module rebuild: manual stock-in and reversible
-- stock adjustments.

CREATE TABLE IF NOT EXISTS public.inventory_stock_adds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  added_by uuid,
  added_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_stock_adds ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_stock_adds_product_id ON public.inventory_stock_adds(product_id);

DROP POLICY IF EXISTS "inventory_stock_adds_select" ON public.inventory_stock_adds;
CREATE POLICY "inventory_stock_adds_select" ON public.inventory_stock_adds FOR SELECT USING (is_crm_user());
-- No write policy — all writes via add_stock (SECURITY DEFINER).

CREATE TABLE IF NOT EXISTS public.inventory_stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity_delta integer NOT NULL CHECK (quantity_delta != 0),
  reason text NOT NULL,
  adjusted_by uuid,
  adjusted_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_stock_adjustments_product_id ON public.inventory_stock_adjustments(product_id);

DROP POLICY IF EXISTS "inventory_stock_adjustments_select" ON public.inventory_stock_adjustments;
CREATE POLICY "inventory_stock_adjustments_select" ON public.inventory_stock_adjustments FOR SELECT USING (is_crm_user());
-- No write policy — all writes via create_stock_adjustment/delete_stock_adjustment (SECURITY DEFINER).

-- ── add_stock ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_stock(
  p_product_id uuid,
  p_quantity integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  INSERT INTO inventory_stock_adds (product_id, quantity, reason, added_by)
  VALUES (p_product_id, p_quantity, p_reason, auth.uid())
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity + p_quantity, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_stock(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_stock(uuid, integer, text) TO authenticated, service_role;

-- ── create_stock_adjustment ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_stock_adjustment(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_current_stock integer;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT stock_quantity INTO v_current_stock FROM products WHERE id = p_product_id;
  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_current_stock + p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'This adjustment would make stock negative. Current stock: %.', v_current_stock;
  END IF;

  INSERT INTO inventory_stock_adjustments (product_id, quantity_delta, reason, adjusted_by)
  VALUES (p_product_id, p_quantity_delta, p_reason, auth.uid())
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity + p_quantity_delta, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, integer, text) TO authenticated, service_role;

-- ── delete_stock_adjustment ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_stock_adjustment(
  p_adjustment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_delta integer;
  v_current_stock integer;
  v_new_stock integer;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT product_id, quantity_delta INTO v_product_id, v_delta
  FROM inventory_stock_adjustments WHERE id = p_adjustment_id;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;

  SELECT stock_quantity INTO v_current_stock FROM products WHERE id = v_product_id;

  -- Reversing means subtracting the original delta back out.
  IF v_current_stock - v_delta < 0 THEN
    RAISE EXCEPTION 'Cannot reverse this adjustment — it would make stock negative. Current stock: %.', v_current_stock;
  END IF;

  UPDATE products SET stock_quantity = stock_quantity - v_delta, updated_at = now()
  WHERE id = v_product_id
  RETURNING stock_quantity INTO v_new_stock;

  DELETE FROM inventory_stock_adjustments WHERE id = p_adjustment_id;

  RETURN jsonb_build_object('new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_adjustment(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Apply + register**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260807_inventory_phase3_stock_movements.sql
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260807', 'inventory_phase3_stock_movements');"
```

- [ ] **Step 3: Verify schema**

```bash
supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'inventory_stock%' ORDER BY table_name;"
```
Expected: `inventory_stock_adds`, `inventory_stock_adjustments`.

- [ ] **Step 4: End-to-end smoke test — all 3 RPCs, including the negative-stock guards**

Record a real product's `stock_quantity` before starting. Then:
1. `add_stock` with a positive quantity — confirm `stock_quantity` increased by exactly that amount.
2. `create_stock_adjustment` with a negative delta larger than current stock — confirm it RAISES an exception (negative-stock guard) and stock is unchanged.
3. `create_stock_adjustment` with a small negative delta that's safe — confirm it succeeds, stock decreases by that amount, and a row lands in `inventory_stock_adjustments`.
4. `delete_stock_adjustment` on that adjustment — confirm stock is restored to what it was before step 3.
5. Clean up: delete the `inventory_stock_adds` test row, restore the product's `stock_quantity` to its exact original value (undo step 1's add manually since adds aren't reversible via RPC).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260807_inventory_phase3_stock_movements.sql
git commit -m "Add inventory phase 3: stock add/adjustment schema + RPCs with negative-stock guards"
```

---

### Task 2: Stock Movements page

**Files:**
- Create: `src/pages/Sales/StockMovementsPage.tsx`
- Create: `src/pages/Sales/AddStockDialog.tsx`
- Create: `src/pages/Sales/StockAdjustmentDialog.tsx`
- Modify: `src/components/sales/SalesLayout.tsx` (add "Stock Movements" nav item)
- Modify: `src/App.tsx` (add `/sales/stock-movements` route)

**Interfaces:**
- Consumes: `Product` type from `ProductsPage.tsx` (for the product picker).

- [ ] **Step 1: Create `AddStockDialog.tsx`** — follow `SupplierPaymentDialog.tsx`'s exact structure (simple form dialog, not a full CRUD dialog since there's no edit/delete for adds). Fields: Product (`Select`, populated from active products, required), Quantity (number, min 1), Reason (`Textarea`, required), Date (defaults today). On save: `supabase.rpc('add_stock' as any, { p_product_id, p_quantity, p_reason })`, toast "Stock added — new quantity: N" on success using the RPC's returned `new_stock_quantity`, toast error and DO NOT close on failure (matching this codebase's established error-handling convention throughout). Guard against an empty/whitespace-only reason client-side before calling the RPC (same UX courtesy as everywhere else, even though the RPC also validates it).

- [ ] **Step 2: Create `StockAdjustmentDialog.tsx`** — Fields: Product (`Select`, required), Adjustment Type (a simple toggle or two radio-like buttons: "Increase" / "Decrease" — NOT a raw signed-number input, to avoid staff confusion about sign conventions), Quantity (number, min 1, always entered as positive; the dialog computes the signed delta internally based on the Increase/Decrease selection before calling the RPC), Reason (`Textarea`, required). On save: `supabase.rpc('create_stock_adjustment' as any, { p_product_id, p_quantity_delta: <computed signed value>, p_reason })`. If the RPC raises the negative-stock error, surface the RPC's actual error message in the toast (it already says "This adjustment would make stock negative. Current stock: X.") rather than a generic error string — this is a deliberately informative error, don't swallow it.

- [ ] **Step 3: Create `StockMovementsPage.tsx`** — follow `SuppliersPage.tsx`'s list-page structure. Two tabs or two stacked sections (pick whichever shadcn pattern is simplest — check if a `Tabs` component already exists in `@/components/ui/tabs` and is used elsewhere in this codebase; if so use it, otherwise two clearly-labeled sections on one page is fine): "Stock Added" (list of `inventory_stock_adds`, joined to `products` for name, columns Date/Product/Quantity/Reason/Added By — read-only, no delete action per Global Constraints) and "Stock Adjustments" (list of `inventory_stock_adjustments`, columns Date/Product/Change (show with a +/- sign and color, e.g. green for positive/red for negative)/Reason/Actions — a Delete button per row with an `AlertDialog` confirmation calling `delete_stock_adjustment`, surfacing the RPC's negative-stock rejection message if it fails). Two "Add" buttons at the top opening the respective dialogs.

- [ ] **Step 4: Wire nav + route** — add `{ label: 'Stock Movements', href: '/sales/stock-movements', icon: ArrowUpDown }` (or another sensible `lucide-react` icon already available) to `SalesLayout.tsx`'s nav array; add the route in `App.tsx`.

- [ ] **Step 5: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/StockMovementsPage.tsx src/pages/Sales/AddStockDialog.tsx src/pages/Sales/StockAdjustmentDialog.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Stock Movements page (stock add + reversible adjustments)"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's Phase 3 scope (Stock Add, Stock Adjustment, reversible with negative-stock guard) fully covered across 2 tasks.
- **Type consistency:** RPC parameter names consistent between Task 1's SQL and Task 2's `.rpc()` calls.
- **No placeholders:** all SQL is complete; the UI task explicitly specifies the Increase/Decrease-toggle UX decision (not a raw signed input) to prevent staff sign-convention confusion, and explicitly requires surfacing the RPC's real error text for the negative-stock case rather than a generic message.
