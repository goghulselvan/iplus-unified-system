# Wrong-Item-Shipped Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When staff know which product was actually shipped by mistake (distinct from what was invoiced), let them record it once on Report Return, so stock corrects itself on the real product on both ends of the return — immediately on report (the wrong item already left the building) and again on confirmed receipt (it's back) — while the credit note continues to track the invoiced product's value throughout.

**Architecture:** One nullable FK column on the existing `product_returns` table, one new optional trailing param on `report_return` (triggers an immediate stock decrement on the actual product when provided), one internal change to `confirm_return_received` (restocks the actual product instead of the invoiced one when set — falls back to today's exact behavior when not). Two UI touches: a conditional product picker on Report Return, and a second line on the Returns queue showing what actually shipped.

**Tech Stack:** Supabase Postgres (SQL migration, `SECURITY DEFINER` RPCs), React + TypeScript, Supabase JS client, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-24-wrong-item-shipped-returns-design.md`

## Global Constraints

- Scope is `wrong_item_shipped` only — no UI or RPC change for the other three reason categories.
- The credit-note amount calculation in `confirm_return_received` (`v_unit_price * v_quantity`, sourced from `invoice_line_items`) must not change — money always tracks the invoice, only stock routing changes.
- The immediate stock decrement in `report_return` is allowed to take stock negative — matches this codebase's existing precedent in `create_invoice` (flags via a warning list, never blocks). Do not add a guard that blocks a negative result.
- `p_actual_product_id` is optional (`DEFAULT NULL`) on `report_return` — when omitted, behavior must be byte-identical to the currently-live function (no stock effect at report time, `confirm_return_received` restocks the invoiced product exactly as today).
- No return-editing/cancellation mechanism — out of scope, do not add one.
- Apply the migration via `supabase db query --linked --file supabase/migrations/<file>.sql` against the linked project (this codebase's established convention).
- No automated test suite exists. Backend gets genuine TDD (a runnable SQL assertion, run before the change exists and after). Frontend "tests" are `tsc --noEmit` plus a documented manual-verification checklist.

---

### Task 1: Schema + RPC changes — actual_product_id, stock routing on both ends

**Files:**
- Create: `supabase/migrations/20260824_wrong_item_shipped_returns.sql`

**Interfaces:**
- Produces: `product_returns.actual_product_id uuid REFERENCES products(id)`, nullable; `report_return(p_invoice_line_item_id uuid, p_quantity integer, p_reason_category text, p_reason_note text, p_actual_product_id uuid DEFAULT NULL)` (new trailing optional param — existing 4-arg call sites are unaffected); `confirm_return_received(p_return_id uuid, p_condition text)` — same signature, new internal routing logic only.

- [ ] **Step 1: Write the verification script and confirm it fails**

Create `/tmp/verify_wrong_item_shipped.sql`:

```sql
-- Should fail today: column doesn't exist yet.
SELECT actual_product_id FROM product_returns LIMIT 1;
```

Run: `supabase db query --linked --file /tmp/verify_wrong_item_shipped.sql`
Expected: error, `column "actual_product_id" does not exist`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260824_wrong_item_shipped_returns.sql
--
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
```

- [ ] **Step 3: Apply the migration and verify the column exists**

Run: `supabase db query --linked --file supabase/migrations/20260824_wrong_item_shipped_returns.sql`
Then re-run: `supabase db query --linked --file /tmp/verify_wrong_item_shipped.sql`
Expected: succeeds (empty result set, no error — table has 0 rows with this column populated yet, that's fine, the point is the column now exists).

- [ ] **Step 4: Full-loop TDD — report with actual_product_id, confirm stock corrects on the right product both times**

Create `/tmp/verify_wrong_item_loop.sql`. This must run inside a single transaction that's rolled back at the end, using two real, currently-inactive-in-production test products so it touches no real data. Adjust to pick two real product ids from the live `products` table if none are safely reusable — but prefer creating two throwaway test rows and deleting them, since this is exercising real stock arithmetic:

```sql
BEGIN;

-- Two throwaway products, isolated from real catalog data.
INSERT INTO products (id, name, unit_price, stock_quantity, series, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'TEST Invoiced Product', 100, 50, 'Ignite Series', true),
  ('22222222-2222-2222-2222-222222222222', 'TEST Actually Shipped Product', 100, 50, 'Ignite Series', true);

-- Need a real school + invoice + line item to attach the return to.
-- (Use an existing school_id from a real row — read one first if needed:
-- SELECT id FROM schools LIMIT 1;)

-- ... build a minimal invoice + invoice_line_item referencing the TEST
-- Invoiced Product, quantity 2, at unit_price 100 ...

-- Report the return, naming the OTHER product as what actually shipped:
SELECT report_return(
  '<the line item id>'::uuid, 2, 'wrong_item_shipped', 'TDD test',
  '22222222-2222-2222-2222-222222222222'::uuid
);

-- Assert: TEST Invoiced Product stock UNCHANGED (still 50), TEST Actually
-- Shipped Product stock DROPPED by 2 (now 48) — immediately, before any
-- receipt confirmation.
SELECT id, name, stock_quantity FROM products WHERE id IN (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);

-- Confirm receipt as resellable:
SELECT confirm_return_received('<the return id from above>'::uuid, 'resellable');

-- Assert: TEST Actually Shipped Product stock back to 50 (restored), TEST
-- Invoiced Product stock still 50 (never touched). Assert the minted
-- credit_notes row's amount = 200 (2 * unit_price of the INVOICED product,
-- not the actual one — both happen to be priced the same here on purpose,
-- so also re-run with different prices on the two test products in a
-- second pass to prove the credit amount really does follow the invoiced
-- product specifically, not whichever one happens to get restocked).
SELECT id, name, stock_quantity FROM products WHERE id IN (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
SELECT amount FROM credit_notes WHERE source_return_id = '<the return id>'::uuid;

ROLLBACK;
```

Run: `supabase db query --linked --file /tmp/verify_wrong_item_loop.sql`
Expected: every assertion above holds. Report the actual numbers observed in the task report, not just "passed."

- [ ] **Step 5: Confirm the `actual_product_id IS NULL` path is unaffected**

Create `/tmp/verify_null_path_unaffected.sql`, same shape as Step 4 but calling `report_return` with only 4 args (no `p_actual_product_id`) or explicitly `NULL` — confirm no stock change happens at report time, and `confirm_return_received` still restocks the *invoiced* product exactly as before this migration. Roll back at the end.

Run it and confirm.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260824_wrong_item_shipped_returns.sql
git commit -m "Add actual_product_id to product_returns; route stock to the real shipped product on wrong-item returns"
```

---

### Task 2: Report Return dialog — the "what was actually sent" picker

**Files:**
- Modify: `src/components/sales/ReportReturnDialog.tsx`

**Interfaces:**
- Consumes: `report_return` (Task 1) — new optional trailing param `p_actual_product_id`; `products` table (`id`, `name`, `is_active`) for the picker's options.
- Produces: no new exports — same default export, same `Props` shape (no prop changes needed; the picker is entirely internal state).

- [ ] **Step 1: Read the current file**

Read `src/components/sales/ReportReturnDialog.tsx` in full before editing — it's short (92 lines), confirm the anchors below still match exactly.

- [ ] **Step 2: Add product-fetching state and the conditional picker**

Add a new state hook and a `useEffect` to fetch active products once, right after the existing `useEffect` that resets form state on open:

```tsx
const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
const [actualProductId, setActualProductId] = useState<string>('');

useEffect(() => {
  if (open) { setQuantity('1'); setReason('wrong_item_shipped'); setNote(''); setActualProductId(''); }
}, [open, lineItem?.id]);

useEffect(() => {
  if (!open) return;
  supabase.from('products').select('id, name').eq('is_active', true).order('name')
    .then(({ data }) => setProducts(data ?? []));
}, [open]);
```

(This replaces the single existing reset-on-open `useEffect` — merge `setActualProductId('')` into it rather than keeping two separate effects for the same trigger.)

- [ ] **Step 3: Add the conditional picker to the form, right after the Reason `Select`**

```tsx
{reason === 'wrong_item_shipped' && (
  <div>
    <Label>What was actually sent instead? <span className="text-muted-foreground font-normal">(optional)</span></Label>
    <Select value={actualProductId} onValueChange={setActualProductId}>
      <SelectTrigger><SelectValue placeholder="Select if known…" /></SelectTrigger>
      <SelectContent>
        {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground mt-1">
      Leave blank if you don't know yet — the return can still be reported, but stock will only
      correct for the invoiced item unless you specify what actually shipped.
    </p>
  </div>
)}
```

- [ ] **Step 4: Pass the new param in the RPC call**

```tsx
const { error } = await supabase.rpc('report_return' as any, {
  p_invoice_line_item_id: lineItem.id,
  p_quantity: qtyNum,
  p_reason_category: reason,
  p_reason_note: note.trim() || null,
  p_actual_product_id: actualProductId || null,
});
```

- [ ] **Step 5: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 6: Manual verification checklist (document in report, cannot run in this environment)**

- Opening the dialog with reason defaulted to "Wrong item shipped" shows the picker.
- Switching reason to any other option hides the picker and clears `actualProductId`.
- Submitting with the picker left blank reports successfully with `p_actual_product_id: null`.
- Submitting with a product selected reports successfully and that product's stock visibly drops
  by the returned quantity immediately (visible on the Products page).

- [ ] **Step 7: Commit**

```bash
git add src/components/sales/ReportReturnDialog.tsx
git commit -m "Report Return: add optional 'what was actually sent instead' picker"
```

---

### Task 3: Returns queue — show what actually shipped

**Files:**
- Modify: `src/pages/Sales/ReturnsPage.tsx`

**Interfaces:**
- Consumes: `product_returns.actual_product_id` (Task 1) joined to `products(name)`.

- [ ] **Step 1: Read the current file**

Read `src/pages/Sales/ReturnsPage.tsx` in full before editing (135 lines) — confirm anchors match.

- [ ] **Step 2: Extend the row type and the select query**

```tsx
type ReturnRow = {
  id: string;
  quantity: number;
  reason_category: string;
  reason_note: string | null;
  status: 'requested' | 'received';
  condition_on_receipt: 'resellable' | 'damaged' | null;
  requested_at: string;
  actual_product: { name: string } | null;
  invoice_line_items: {
    item_name: string;
    invoices: { invoice_number: number | null; fy: number | null; schools: { school_name: string; ss_no: number | null } | null } | null;
  } | null;
};
```

Update the query's `.select(...)` to add the embedded relation (the FK is `product_returns.actual_product_id → products.id`; alias it so PostgREST doesn't need to guess which relationship, since `product_returns` may gain other product FKs later — explicit is safer). The constraint name below (`product_returns_actual_product_id_fkey`) is Postgres's standard `<table>_<column>_fkey` default — confirmed against this exact table's existing FK (`product_returns_invoice_line_item_id_fkey` follows the identical pattern), so this is not a guess:

```tsx
.select(`
  id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
  actual_product:products!product_returns_actual_product_id_fkey ( name ),
  invoice_line_items ( item_name, invoices ( invoice_number, fy, schools ( school_name, ss_no ) ) )
`)
```

- [ ] **Step 3: Show the second line in the Item column**

```tsx
<TableCell>
  {r.invoice_line_items?.item_name ?? '—'}
  {r.actual_product && (
    <p className="text-xs text-amber-600 mt-0.5">Shipped instead: {r.actual_product.name}</p>
  )}
</TableCell>
```

(Replaces the current single-line `<TableCell>{r.invoice_line_items?.item_name ?? '—'}</TableCell>`.)

- [ ] **Step 4: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output. If the embedded-relation alias syntax (`products!product_returns_actual_product_id_fkey`) produces a type error against the generated Supabase types (this table/relation may not be in generated types at all, matching the rest of this feature — check for an existing `as any` cast pattern already used elsewhere on this exact table in this same file, and apply the same cast to the query if needed).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/ReturnsPage.tsx
git commit -m "Returns queue: show what actually shipped, when it differs from the invoiced item"
```

---

## Post-plan verification (controller does this after Task 3, not a task itself)

- Live click-through by Goghul still owed for this addition too, same standing item as the rest of Sales module this session.
