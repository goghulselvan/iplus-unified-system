# Inventory Module — Phase 5: Item Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internal stock issuance (handing out consumables to students/staff, no sale/invoice/payment attached) — the fifth of 6 phases (see `docs/superpowers/specs/2026-08-04-inventory-module-rebuild-design.md`). This is independent of and can be built in parallel with Phase 3 (Stock Movements) — different table, different files, both only depend on the already-merged Phase 1 `products` table.

**Architecture:** One new table (`inventory_item_issues`) plus one SECURITY DEFINER RPC (`issue_item` — inserts the issue record and decrements stock atomically, mirroring `create_invoice`'s stock-decrement pattern exactly, since issuing is conceptually "a sale with no money changing hands").

**Tech Stack:** React + TypeScript + Vite, shadcn/ui, Supabase (Postgres + supabase-js + RPCs).

## Global Constraints

- Never use `supabase db push` — apply with `supabase db query --linked --file <path>`, register in `supabase_migrations.schema_migrations`.
- RLS: `is_crm_user()`.
- No test framework — verify via `npx tsc --noEmit` + `npm run build` + direct SQL smoke tests with before/after/cleanup discipline.
- RPC style must match `create_invoice` exactly: SECURITY DEFINER, `SET search_path = public`, `is_crm_user()` first, `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO authenticated, service_role`.
- Issuing follows the same warn-don't-block philosophy as `create_invoice`'s stock decrement — issuing more than available stock is allowed (stock can go negative), not rejected. This is DIFFERENT from Phase 3's stock adjustments, which explicitly reject going negative — the two features have deliberately different policies (a stock *adjustment* is a manual correction where a negative result signals a real counting error worth catching immediately; an *issue* is a real-world event that already happened by the time it's logged — the system should record what occurred, not second-guess it after the fact). Do not unify these two policies; they are intentionally different.

---

### Task 1: Migration — `inventory_item_issues` table + `issue_item` RPC

**Files:**
- Create: `supabase/migrations/20260808_inventory_phase5_item_issue.sql`

**Interfaces:**
- Produces: `inventory_item_issues(id, product_id, issued_to_type, issued_to_name, quantity, issued_by, issue_date, notes, created_at)`; `issue_item(p_product_id uuid, p_issued_to_type text, p_issued_to_name text, p_quantity integer, p_notes text) RETURNS jsonb` (returns `{id, new_stock_quantity}`).

- [ ] **Step 1: Write the migration file**

```sql
-- Phase 5 of inventory module rebuild: internal stock issuance (no sale/
-- invoice attached — e.g. handing out consumables to students/staff).

CREATE TABLE IF NOT EXISTS public.inventory_item_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  issued_to_type text NOT NULL CHECK (issued_to_type IN ('student', 'staff', 'other')),
  issued_to_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  issued_by uuid,
  issue_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_item_issues ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_inventory_item_issues_product_id ON public.inventory_item_issues(product_id);

DROP POLICY IF EXISTS "inventory_item_issues_select" ON public.inventory_item_issues;
CREATE POLICY "inventory_item_issues_select" ON public.inventory_item_issues FOR SELECT USING (is_crm_user());
-- No write policy — all writes via issue_item (SECURITY DEFINER).

-- ── issue_item ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_item(
  p_product_id uuid,
  p_issued_to_type text,
  p_issued_to_name text,
  p_quantity integer,
  p_notes text
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
  IF p_issued_to_name IS NULL OR trim(p_issued_to_name) = '' THEN
    RAISE EXCEPTION 'Issued-to name is required';
  END IF;
  IF p_issued_to_type NOT IN ('student', 'staff', 'other') THEN
    RAISE EXCEPTION 'Invalid issued_to_type';
  END IF;

  INSERT INTO inventory_item_issues (product_id, issued_to_type, issued_to_name, quantity, issued_by, notes)
  VALUES (p_product_id, p_issued_to_type, trim(p_issued_to_name), p_quantity, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  UPDATE products SET stock_quantity = stock_quantity - p_quantity, updated_at = now()
  WHERE id = p_product_id
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'new_stock_quantity', v_new_stock);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_item(uuid, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_item(uuid, text, text, integer, text) TO authenticated, service_role;
```

- [ ] **Step 2: Apply + register**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260808_inventory_phase5_item_issue.sql
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260808', 'inventory_phase5_item_issue');"
```

- [ ] **Step 3: Verify schema**

```bash
supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='inventory_item_issues' ORDER BY ordinal_position;"
```

- [ ] **Step 4: End-to-end smoke test, including the allowed-to-go-negative behavior**

Record a real product's `stock_quantity` before starting. Then:
1. `issue_item` with a normal quantity well within current stock — confirm stock decreased by exactly that amount and a row landed in `inventory_item_issues`.
2. `issue_item` again with a quantity LARGER than what's currently left (deliberately trigger a would-be-negative result) — confirm this SUCCEEDS (does NOT raise an exception), and stock genuinely goes negative, proving the warn-don't-block policy is real and not accidentally copied from Phase 3's reject-on-negative behavior.
3. Clean up: delete both test `inventory_item_issues` rows, restore the product's `stock_quantity` to its exact original value.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808_inventory_phase5_item_issue.sql
git commit -m "Add inventory phase 5: item issue schema + issue_item RPC (warn-don't-block on stock)"
```

---

### Task 2: Item Issue page

**Files:**
- Create: `src/pages/Sales/ItemIssuePage.tsx`
- Create: `src/pages/Sales/IssueItemDialog.tsx`
- Modify: `src/components/sales/SalesLayout.tsx` (add "Item Issue" nav item)
- Modify: `src/App.tsx` (add `/sales/item-issue` route)

**Interfaces:**
- Consumes: `Product` type from `ProductsPage.tsx`.

- [ ] **Step 1: Create `IssueItemDialog.tsx`** — follow `AddStockDialog.tsx`'s structure (from Phase 3, if already merged by the time this task runs — check `src/pages/Sales/` for it; if Phase 3 hasn't merged yet, follow `SupplierPaymentDialog.tsx`'s structure instead as the fallback reference). Fields: Product (`Select`, active products, required), Issued To Type (`Select`: Student/Staff/Other), Issued To Name (text input, required — free text, not a picker into the student/staff tables, since this is a lightweight internal log, not a formal student-records integration), Quantity (number, min 1), Notes (`Textarea`, optional). On save: `supabase.rpc('issue_item' as any, { p_product_id, p_issued_to_type, p_issued_to_name, p_quantity, p_notes })`. Since over-issuing (going negative) is explicitly ALLOWED by the RPC, do not add any client-side quantity cap — but DO show a plain (non-blocking) warning inline if the entered quantity exceeds the selected product's currently-known stock, so staff have visibility without being stopped (matching the "warn, don't block" language used for invoicing elsewhere in this module). Toast "Item issued — remaining stock: N" on success using the RPC's returned value (which may be negative — display it as-is, don't clamp it, since a negative number here is meaningful signal that stock needs attention).

- [ ] **Step 2: Create `ItemIssuePage.tsx`** — follow `SuppliersPage.tsx`'s list-page structure. Table columns: Date / Product / Issued To (Type badge + Name) / Quantity / Issued By / Notes. Read-only list (no edit/delete — an issue record represents something that already physically happened; corrections go through a Phase 3 stock adjustment with a note explaining the correction, not by editing history). "Issue Item" button opening the dialog.

- [ ] **Step 3: Wire nav + route** — add `{ label: 'Item Issue', href: '/sales/item-issue', icon: PackageMinus }` (or another sensible `lucide-react` icon) to `SalesLayout.tsx`'s nav array; add the route in `App.tsx`.

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/ItemIssuePage.tsx src/pages/Sales/IssueItemDialog.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Item Issue page (internal stock issuance, no invoice attached)"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's Phase 5 scope (issue stock to student/staff/other, no invoice, decrements stock) fully covered across 2 tasks.
- **Deliberate policy divergence from Phase 3, flagged explicitly:** issuing allows negative stock (warn-don't-block, matching `create_invoice`); stock adjustments reject negative stock outright. Both plans state this explicitly so neither implementer "fixes" one to match the other by mistake.
- **No placeholders:** SQL is complete; UI task explicitly specifies the no-client-side-cap-but-show-a-warning UX and the read-only nature of the issue log.
- **Cross-plan file conflict risk:** since this plan and Phase 3's plan may execute concurrently, both add a nav item to `SalesLayout.tsx` and a route to `App.tsx` — these are two small, additive edits to shared files. If both land at the same time, whichever merges second will need a trivial manual re-merge of these two files (adding both nav entries, both routes) rather than a real conflict — flag this to whoever is coordinating both phases' merges.
