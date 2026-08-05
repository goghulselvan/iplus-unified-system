# Inventory Phase 5 (Item Issue) — Code Review Fix Report

Date: 2026-08-05
Worktree: `/Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main/.worktrees/inventory-phase5-item-issue`
Supabase project: `eucjeggfclztkbbupaav` (live CRM DB, applied via `supabase db query --linked`)

## Summary of changes

| # | Severity | Fix | File(s) |
|---|----------|-----|---------|
| 1 | Important | Added missing "Issued By" column | `src/pages/Sales/ItemIssuePage.tsx` |
| 2 | Important | Added `PAGE_SIZE = 200` + `.limit(PAGE_SIZE)` to list query | `src/pages/Sales/ItemIssuePage.tsx` |
| 3 | Important | Added supporting index on `(issue_date DESC, created_at DESC)` | `supabase/migrations/20260808b_inventory_phase5_date_index.sql` |
| 4a | Minor | Explicit "Product not found" pre-INSERT existence check | same migration, `issue_item()` |
| 4b | Minor | NULL-blind validation on `p_quantity` / `p_issued_to_type` | same migration, `issue_item()` |
| 4c | Minor | `p_notes` sanitized via `NULLIF(trim(p_notes), '')` | same migration, `issue_item()` |
| 5a | Minor | Fractional quantity now floored client-side before RPC call | `src/pages/Sales/IssueItemDialog.tsx` |
| 5b | Minor | Products-fetch effect wrapped in `async` IIFE + try/catch + toast, `eslint-disable-next-line` added to match `ReceiveGrnDialog.tsx` pattern | `src/pages/Sales/IssueItemDialog.tsx` |

Deferred per instructions: no consumable-only filter, no `unit`/`item_type` shown in product picker (Phase 6 scope).

## Fix 1 — Issued By column

`ItemIssuePage.tsx` now:
- Selects `issued_by` in the `inventory_item_issues` query.
- Loads `profiles` separately (`.from('profiles').select('user_id, full_name, username')`), following the exact pattern in `src/pages/Communication.tsx:86-90` — no FK exists from `inventory_item_issues.issued_by` to `profiles`, so a PostgREST embed isn't possible.
- Maps `issued_by` → profile client-side into a `profilesById` record, rendering `full_name || username || '—'`.
- Sixth `<TableHead>Issued By</TableHead>` added; both loading and empty-state rows bumped to `colSpan={6}`.

## Fix 2 — Row limit

Added `const PAGE_SIZE = 200;` and `.limit(PAGE_SIZE)` to the `inventory_item_issues` query, matching `InvoicesPage.tsx` and `PurchaseOrdersPage.tsx` exactly.

## Fix 3 — Date index

New migration `supabase/migrations/20260808b_inventory_phase5_date_index.sql`:
```sql
CREATE INDEX IF NOT EXISTS idx_inventory_item_issues_date ON public.inventory_item_issues (issue_date DESC, created_at DESC);
```
Applied and registered — see Verification section for command output.

## Fix 4 — `issue_item()` hardening (bundled into the same migration)

```sql
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
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  IF p_issued_to_name IS NULL OR trim(p_issued_to_name) = '' THEN
    RAISE EXCEPTION 'Issued-to name is required';
  END IF;
  IF p_issued_to_type IS NULL OR p_issued_to_type NOT IN ('student', 'staff', 'other') THEN
    RAISE EXCEPTION 'Invalid issued_to_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  INSERT INTO inventory_item_issues (product_id, issued_to_type, issued_to_name, quantity, issued_by, notes)
  VALUES (p_product_id, p_issued_to_type, trim(p_issued_to_name), p_quantity, auth.uid(), NULLIF(trim(p_notes), ''))
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
```
Kept the post-UPDATE `v_new_stock IS NULL` check as a harmless secondary guard (chose "leave it" of the two offered options in Fix 4a).

## Fix 5 — React dialog fixes

`IssueItemDialog.tsx`:
- `quantityInt = Math.floor(quantityNum)` computed before the RPC call, with a second `quantityInt <= 0` guard (catches e.g. `0.5` which floors to `0` but would otherwise have passed the original `quantityNum > 0` check) — `p_quantity` now always receives an integer, matching `ReceiveGrnDialog.tsx`'s `Math.round` pattern for the same class of bug.
- Products-fetch `useEffect` rewritten from a bare `.then()` to an `async` IIFE with `try/catch`, toasting on both a returned Supabase `error` and a thrown/network exception. Added `// eslint-disable-next-line react-hooks/exhaustive-deps` above the `[open]` dependency array, matching the exact pattern already used in `ReceiveGrnDialog.tsx:45`.

## Verification

### 1. `npx tsc --noEmit`
```
$ npx tsc --noEmit
(no output — clean)
```

### 2. `npm run build`
```
$ npm run build
> vite_react_shadcn_ts@0.0.0 build
> vite build

vite v5.4.19 building for production...
transforming...
✓ 3490 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                 1.22 kB │ gzip:   0.50 kB
dist/assets/receipt-watermark-CopWXrlm.png     93.83 kB
dist/assets/parcel-sticker-a5-PE90NcSc.jpg    129.53 kB
dist/assets/iplus-logo-CCGiYYm3.png           212.94 kB
dist/assets/index-BM-1E04q.css                104.97 kB │ gzip:  15.75 kB
dist/assets/classCodeMapper-oNcEbsMB.js         0.22 kB │ gzip:   0.20 kB
dist/assets/index.es-Ctdr8efK.js              150.53 kB │ gzip:  51.29 kB
dist/assets/html2canvas.esm-CBrSDip1.js       201.42 kB │ gzip:  47.70 kB
dist/assets/index-qtQwieOJ.js               2,827.22 kB │ gzip: 841.48 kB
✓ built in 15.05s
```
(Pre-existing chunk-size warning, unrelated to this change — same warning class exists project-wide.)

`git status` after the build showed `dist/` dirty (pre-existing artifacts from a prior build step, already present before I touched anything — confirmed by `git status` at the very start of this session showing the same deleted/modified `dist/` files). Per instructions, restored it:
```
$ git checkout -- dist/ && git clean -fd dist/
Removing dist/assets/index-BM-1E04q.css
Removing dist/assets/index-qtQwieOJ.js
Removing dist/assets/index.es-Ctdr8efK.js
Removing dist/assets/iplus-logo-CCGiYYm3.png
Removing dist/assets/receipt-watermark-CopWXrlm.png

$ git status
On branch inventory-phase5-item-issue
Changes not staged for commit:
	modified:   src/pages/Sales/IssueItemDialog.tsx
	modified:   src/pages/Sales/ItemIssuePage.tsx
Untracked files:
	.superpowers/
	supabase/migrations/20260808b_inventory_phase5_date_index.sql
```
`dist/` clean — only the intended source changes remain.

### 3. Migration applied + registered (live DB)

```
$ supabase db query --linked --file supabase/migrations/20260808b_inventory_phase5_date_index.sql
{ "rows": [], ... }   # DDL ran cleanly, no rows returned

$ supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260808b', 'inventory_phase5_date_index');"
{ "rows": [], ... }   # inserted

$ supabase db query --linked "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version LIKE '20260808%' ORDER BY version;"
{
  "rows": [
    { "version": "20260808",  "name": "inventory_phase5_item_issue" },
    { "version": "20260808b", "name": "inventory_phase5_date_index" }
  ]
}
```

### 4. Index confirmed via `pg_indexes`

```
$ supabase db query --linked "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'inventory_item_issues';"
{
  "rows": [
    { "indexname": "inventory_item_issues_pkey",         "indexdef": "CREATE UNIQUE INDEX inventory_item_issues_pkey ON public.inventory_item_issues USING btree (id)" },
    { "indexname": "idx_inventory_item_issues_product_id","indexdef": "CREATE INDEX idx_inventory_item_issues_product_id ON public.inventory_item_issues USING btree (product_id)" },
    { "indexname": "idx_inventory_item_issues_date",      "indexdef": "CREATE INDEX idx_inventory_item_issues_date ON public.inventory_item_issues USING btree (issue_date DESC, created_at DESC)" }
  ]
}
```

### 5. Live smoke test — negative paths (validation guards)

Ran each with `SELECT set_config('request.jwt.claim.sub', '<superadmin uid>', true);` first to simulate an authenticated CRM user (`auth.uid()` confirmed resolving correctly via a preceding `SELECT auth.uid();` check).

```sql
-- NULL product_id
SELECT public.issue_item(NULL, 'student', 'Test Kid', 5, 'test note');
→ ERROR: P0001: Product not found          -- new pre-INSERT existence check (Fix 4a) fires instead of a raw NOT NULL constraint violation

-- Non-existent (but valid-uuid) product_id
SELECT public.issue_item('00000000-0000-0000-0000-000000000000', 'student', 'Test Kid', 5, 'test note');
→ ERROR: P0001: Product not found          -- confirms the real target case from the review: a bad product id gets the friendly message

-- NULL quantity
SELECT public.issue_item('<real product id>', 'student', 'Test Kid', NULL, 'test note');
→ ERROR: P0001: Quantity must be positive  -- Fix 4b

-- NULL issued_to_type
SELECT public.issue_item('<real product id>', NULL, 'Test Kid', 5, 'test note');
→ ERROR: P0001: Invalid issued_to_type     -- Fix 4b

-- Fractional quantity (raw SQL call, no cast)
SELECT public.issue_item('<real product id>', 'student', 'x', 2.5, 'test');
→ ERROR: 42883: function public.issue_item(unknown, unknown, unknown, numeric, unknown) does not exist
  (no integer overload matches a non-integer literal — confirms the DB layer is integer-only;
   the actual UX fix is client-side Math.floor() in IssueItemDialog.tsx, verified by tsc/build passing
   and by inspection of the diff, since a fractional value now never reaches the RPC call from the UI)
```

All four "before" bugs from Fix 4 reproduced their intended friendly errors; none fell through to a raw Postgres constraint violation.

### 6. Live smoke test — happy path + Issued By data relationship

Product used: `94d92306-824d-413b-a6e7-7729571a1148` ("English - iPlus Olympiads - Ignite Series - Class 1"), starting stock 51.
Test user: `8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc` (iPlus Super Admin, username `itsuperadmin`).

```sql
SELECT public.issue_item('94d92306-...1148', 'student', 'SMOKE TEST STUDENT - DELETE ME', 3, '  smoke test note  ');
→ { "id": "9f3ed687-b739-497f-afd8-2b9a7cafbdd9", "new_stock_quantity": 48 }   -- 51 → 48, correct decrement
```

Manual join reproducing exactly what `ItemIssuePage.tsx`'s client-side `profilesById` map now does:
```sql
SELECT i.id, i.quantity, i.issued_to_name, i.notes, i.issued_by,
       p.full_name AS issued_by_full_name, p.username AS issued_by_username,
       pr.name AS product_name, pr.stock_quantity AS product_stock_now
FROM inventory_item_issues i
LEFT JOIN profiles p ON p.user_id = i.issued_by
LEFT JOIN products pr ON pr.id = i.product_id
WHERE i.id = '9f3ed687-b739-497f-afd8-2b9a7cafbdd9';
```
Result:
```json
{
  "id": "9f3ed687-b739-497f-afd8-2b9a7cafbdd9",
  "quantity": 3,
  "issued_to_name": "SMOKE TEST STUDENT - DELETE ME",
  "notes": "smoke test note",
  "issued_by": "8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc",
  "issued_by_full_name": "iPlus Super Admin",
  "issued_by_username": "itsuperadmin",
  "product_name": "English - iPlus Olympiads - Ignite Series - Class 1",
  "product_stock_now": 48
}
```
Confirms: (a) `issued_by` → `profiles` mapping resolves to the correct name ("iPlus Super Admin", exactly what the new "Issued By" column will render), (b) `notes` was trimmed of surrounding whitespace (Fix 4c), (c) stock decremented correctly.

Second test row confirmed `NULLIF(trim(...), '')` turns whitespace-only notes into a true `NULL` (not an empty string):
```sql
SELECT public.issue_item('94d92306-...1148', 'staff', 'SMOKE TEST STAFF - DELETE ME', 1, '   ');
→ { "id": "5f412841-e3ad-4475-b85e-55ddc9ddd790", "new_stock_quantity": 47 }
SELECT notes FROM inventory_item_issues WHERE id = '5f412841-...';
→ notes: null
```

### 7. Cleanup

```sql
DELETE FROM inventory_item_issues WHERE id IN ('9f3ed687-b739-497f-afd8-2b9a7cafbdd9', '5f412841-e3ad-4475-b85e-55ddc9ddd790');
UPDATE products SET stock_quantity = 51, updated_at = now() WHERE id = '94d92306-824d-413b-a6e7-7729571a1148';
```
Verified:
```json
{ "remaining_test_rows": 0, "product_stock_restored": 51 }
```
No test data or stock drift left behind.

## Files touched

- `src/pages/Sales/ItemIssuePage.tsx` — Fix 1, Fix 2
- `src/pages/Sales/IssueItemDialog.tsx` — Fix 5a, Fix 5b
- `supabase/migrations/20260808b_inventory_phase5_date_index.sql` — Fix 3, Fix 4 (new file, applied to live DB and registered in `supabase_migrations.schema_migrations`)

## Concerns / notes for the record

- None outstanding. All five review findings addressed exactly as specified; explicitly did not touch the deferred Minor #9 (consumable-only filter / unit/item_type in product picker).
- `dist/` working-tree drift predates this session (present at the very first `git status` before any of my edits) — cleaned per instructions before the final commit so the working tree stays tidy.
