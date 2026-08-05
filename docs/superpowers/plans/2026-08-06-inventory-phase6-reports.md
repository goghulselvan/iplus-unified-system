# Inventory Module — Phase 6: Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only reporting views on top of the already-built inventory data — the sixth and final phase (see `docs/superpowers/specs/2026-08-04-inventory-module-rebuild-design.md`). Depends on Phase 1 (`products`), Phase 2 (`inventory_suppliers`/`inventory_purchase_orders`/`inventory_po_items`/`inventory_grn`/`inventory_grn_items`), and Phase 5 (`inventory_item_issues`) — all merged to `main`.

**Architecture:** No new tables, no new RPCs. Every SELECT policy needed already exists (`products_select`, `inventory_po_select`, `inventory_po_items_select`, `inventory_grn_select`, `inventory_grn_items_select`, `inventory_suppliers_select`, `inventory_item_issues_select` — all gated by `is_crm_user()`). This phase is pure UI: two new read-only pages (Stock Report, Purchase Report) plus an in-place extension of the existing Item Issue page (adding a report section rather than duplicating its table — the existing page already lists every issue; a second nearly-identical page would be pure duplication).

**Tech Stack:** React + TypeScript + Vite, shadcn/ui, Supabase (Postgres + supabase-js, direct `.select()` — no RPCs in this phase).

## Global Constraints

- No test framework — verify via `npx tsc --noEmit` + `npm run build` + direct SQL smoke tests (read-only checks: confirm the numbers a page shows match hand-computed SQL aggregates).
- All queries go through supabase-js `.from(...).select(...)` directly (not RPCs) — every table this phase reads already has a working `SELECT` RLS policy keyed on `is_crm_user()`. Do not write any migration file in this phase.
- All 3 report surfaces are strictly read-only: no add/edit/delete/export actions. Follow `ProductsPage.tsx`'s existing conventions for page shell (`SalesLayout` wrapper, shadcn `Table`, loading state) but omit all mutation UI (no `Plus`/`Pencil`/`Trash2` buttons, no dialogs).
- Money formatting: `₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` (matches `InvoicesPage.tsx`'s `grand_total` display).
- Date formatting: `new Date(dateStr).toLocaleDateString('en-IN')` (matches Phase 3/5 convention).
- User-name lookups (created_by/received_by/issued_by → display name): join against `profiles` table via a `Record<string, {full_name, username}>` map built from one `supabase.from('profiles').select('user_id, full_name, username')` call, exactly as `StockMovementsPage.tsx` and `ItemIssuePage.tsx` already do. Display `full_name || username || '—'`.
- Cast every table not yet in the generated Supabase types with `as any` on the `.from(...)` call, matching every other inventory page in this codebase (`inventory_suppliers' as any`, etc.).

---

### Task 1: Stock Report page

**Files:**
- Create: `src/pages/Sales/StockReportPage.tsx`
- Modify: `src/components/sales/SalesLayout.tsx` (add nav item)
- Modify: `src/App.tsx` (add route)

**Interfaces:**
- Consumes: `products` table columns `id, name, sku, category_id, series, subject, class_number, unit, stock_quantity, minimum_stock_level, unit_price, is_active`; `product_categories(id, name)` for category names; reuses `ProductsFilterBar` (`@/pages/Sales/ProductsFilterBar` exports `ProductFilters` type and `DEFAULT_FILTERS`) for the category/series/subject/class/stockStatus filter controls — do not rebuild filter UI from scratch.
- Produces: nothing consumed by later tasks (this is the last file of this phase's UI along with Task 2/3).

- [ ] **Step 1: Create `StockReportPage.tsx`**

Route component, wrapped in `<SalesLayout>`. On mount, load all `products` (only `is_active = true` — an inactive/discontinued product's stock level isn't operationally relevant to a stock report) joined with `product_categories(name)`, plus load `product_categories` for the filter bar's category dropdown, mirroring `ProductsPage.tsx`'s `loadCategories`.

Define locally (same logic as `ProductsPage.tsx`, duplicated here deliberately since this file must not import from `ProductsPage.tsx` — a page component, not a shared module):

```tsx
const isOutOfStock = (p: { stock_quantity: number }) => p.stock_quantity <= 0;
const isLowStock = (p: { stock_quantity: number; minimum_stock_level: number }) =>
  !isOutOfStock(p) && p.stock_quantity < p.minimum_stock_level;
```

Reuse `ProductsFilterBar` with local `filters` state seeded from `DEFAULT_FILTERS`, exactly as `ProductsPage.tsx` wires it up — same props (`filters`, `onChange`, `categories`, `seriesOptions`, `subjectOptions`, `classOptions`), computed with the same `useMemo` pattern from the loaded products list.

Above the table, render 3 summary cards (simple `<div>` grid, shadcn `Card` if already imported elsewhere in Sales pages — check `PurchaseOrderDetail.tsx`/`SuppliersPage.tsx` for whether `Card` is already a used import in this folder; if not, plain styled `div`s matching the visual weight of existing Sales pages is fine, no need to introduce a new component import) computed from the **full unfiltered** product list (not affected by the filter bar — these are always the true totals):
- "Out of Stock" — count where `isOutOfStock`
- "Low Stock" — count where `isLowStock`
- "Total Stock Value" — `Σ stock_quantity * unit_price` across all active products (clamp negative `stock_quantity` to 0 for this sum only — a negative-stock product, possible after Phase 5 over-issuing, contributes nothing to a *value* total, though its row still appears in the table below with its true, possibly-negative, quantity)

Table columns: Category / SKU / Name / Series / Subject-Class / Current Stock / Minimum Level / Status / Stock Value (`stock_quantity * unit_price`, showing the raw value even if negative — do not clamp in the per-row display, only in the summary card total). Status column badge: reuse the same 3-state look `ProductsPage.tsx` uses (`isOutOfStock` → destructive-style badge "Out of Stock", `isLowStock` → warning-style badge "Low Stock", else a plain "OK" badge or no badge).

Default row order: out-of-stock rows first, then low-stock, then the rest, each group alphabetical by `name` — so the exceptions needing attention surface at the top without requiring the viewer to filter.

- [ ] **Step 2: Wire nav + route**

Add to `src/components/sales/SalesLayout.tsx`'s `nav` array (after 'Item Issue'): `{ label: 'Stock Report', href: '/sales/stock-report', icon: BarChart3 }` — add `BarChart3` to the existing `lucide-react` import line.

Add to `src/App.tsx`: `<Route path="/sales/stock-report" element={<ProtectedRoute><StockReportPage /></ProtectedRoute>} />` plus the corresponding import.

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Smoke test**

```bash
supabase db query --linked "SELECT count(*) FILTER (WHERE stock_quantity <= 0) AS out_of_stock, count(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity < minimum_stock_level) AS low_stock, sum(GREATEST(stock_quantity,0) * unit_price) AS total_value FROM products WHERE is_active = true;"
```

Confirm these three numbers match what the page's summary cards show (ask the user to click through, per `[[feedback_no_crm_login_verify_via_cli]]` — no CRM login available in this environment).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/StockReportPage.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Stock Report page (out-of-stock/low-stock exceptions + stock value summary)"
```

---

### Task 2: Purchase Report page

**Files:**
- Create: `src/pages/Sales/PurchaseReportPage.tsx`
- Modify: `src/components/sales/SalesLayout.tsx` (add nav item)
- Modify: `src/App.tsx` (add route)

**Interfaces:**
- Consumes: `inventory_purchase_orders(id, po_number, supplier_id, order_date, status, created_at)`, `inventory_po_items(purchase_order_id, quantity_ordered, unit_cost)`, `inventory_grn(id, purchase_order_id, received_date)`, `inventory_grn_items(grn_id, po_item_id, quantity_received)`, `inventory_suppliers(id, name)`. `PoStatus` values: `'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'` (from `PurchaseOrdersPage.tsx`) — reuse the same `STATUS_LABELS` mapping and badge-color logic (`cancelled` → destructive, `received` → default) rather than inventing new copy.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create `PurchaseReportPage.tsx`**

One row per Purchase Order (not grouped/nested by supplier — filterable BY supplier via a dropdown instead, matching this codebase's existing filter-dropdown convention rather than introducing a new nested/expandable UI pattern). On mount, load in parallel:
- `inventory_purchase_orders` (all columns above) ordered by `order_date desc`
- `inventory_po_items` (`purchase_order_id, quantity_ordered, unit_cost`) — aggregate client-side per PO into `orderedValue = Σ quantity_ordered * unit_cost` and `orderedQty = Σ quantity_ordered`
- `inventory_grn` (`id, purchase_order_id, received_date`) plus `inventory_grn_items(grn_id, quantity_received)` — aggregate client-side per PO into `receivedQty = Σ quantity_received` (joining grn_items → grn → purchase_order_id) and `lastReceivedDate` (max `received_date` across that PO's GRNs)
- `inventory_suppliers` (`id, name`) for the supplier name column and the supplier filter dropdown options

Filter controls (simple `Select` dropdowns, no need for a separate filter-bar component given only 2 filters): Supplier (all suppliers + "All"), Status (all `PoStatus` values + "All").

Summary cards above the table, computed from the **currently filtered** set (unlike Task 1's cards, which are always global — here the report is explicitly meant to answer "for this supplier/status, what's the picture," so the cards should move with the filter): Total POs / Total Ordered Value / Total Received Value (`Σ quantity_received * unit_cost`, using each PO item's own `unit_cost`) / Pending POs count (`status IN ('draft','ordered','partially_received')`).

Table columns: PO Number / Supplier / Order Date / Status (badge) / Ordered Qty / Received Qty / Ordered Value / Last Received Date (`—` if no GRN yet).

- [ ] **Step 2: Wire nav + route**

Add to `SalesLayout.tsx`'s `nav` array (after 'Stock Report'): `{ label: 'Purchase Report', href: '/sales/purchase-report', icon: FileBarChart }` — add `FileBarChart` to the `lucide-react` import.

Add to `App.tsx`: `<Route path="/sales/purchase-report" element={<ProtectedRoute><PurchaseReportPage /></ProtectedRoute>} />` plus import.

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Smoke test**

```bash
supabase db query --linked "SELECT po.id, po.po_number, po.status, (SELECT sum(quantity_ordered * unit_cost) FROM inventory_po_items WHERE purchase_order_id = po.id) AS ordered_value, (SELECT sum(gi.quantity_received) FROM inventory_grn g JOIN inventory_grn_items gi ON gi.grn_id = g.id WHERE g.purchase_order_id = po.id) AS received_qty FROM inventory_purchase_orders po ORDER BY po.order_date DESC LIMIT 5;"
```

Confirm a handful of rows match the page's table (ask the user to click through — no CRM login available in this environment).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/PurchaseReportPage.tsx src/components/sales/SalesLayout.tsx src/App.tsx
git commit -m "Add Purchase Report page (PO/GRN history, filterable by supplier and status)"
```

---

### Task 3: Item Issue Report extension

**Files:**
- Modify: `src/pages/Sales/ItemIssuePage.tsx` (add report summary + date-range filter in place)

**Interfaces:**
- Consumes: the existing `inventory_item_issues` query already in this file (`product_id, issued_to_type, issued_to_name, quantity, issued_by, issue_date, notes`).
- Produces: nothing (final task of this phase).

No new page — the design doc's "Item Issue Report" requirement is already ~90% satisfied by Phase 5's existing read-only issue log in this file. Building a second, near-identical table would be pure duplication. Instead, extend the existing page:

- [ ] **Step 1: Add a date-range filter**

Add two `Input type="date"` controls ("From" / "To", both optional) above the existing table, next to the existing "Issue Item" button. Filter the already-loaded `issues` list client-side by `issue_date` falling within the selected range (no range = no filtering, i.e. current behavior unchanged when both are left blank). Keep the existing `PAGE_SIZE = 200` load — do not change the underlying query, filter only the already-fetched rows.

- [ ] **Step 2: Add summary cards**

Above the table (below the new date filter), computed from the **currently filtered** (by date range) rows: "Total Quantity Issued" (`Σ quantity`), "Issued to Students" (`Σ quantity WHERE issued_to_type = 'student'`), "Issued to Staff" (`Σ quantity WHERE issued_to_type = 'staff'`), "Issued to Other" (`Σ quantity WHERE issued_to_type = 'other'`). Same lightweight card treatment as Task 1/2 — keep visual consistency across all 3 report surfaces introduced in this phase.

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Smoke test**

```bash
supabase db query --linked "SELECT issued_to_type, sum(quantity) FROM inventory_item_issues GROUP BY issued_to_type;"
```

Confirm these totals match the new summary cards with no date filter applied (ask the user to click through).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/ItemIssuePage.tsx
git commit -m "Extend Item Issue page with date-range filter and quantity summary (satisfies Phase 6 Item Issue Report scope)"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's 3 named reports (Stock, Purchase, Item Issue) covered — Stock and Purchase as genuinely new pages, Item Issue as an in-place extension of the existing operational page rather than a duplicate.
- **"Extend rather than duplicate" applied twice:** the design doc states this explicitly for Sales/Invoices reporting (out of scope for this phase — `InvoicesPage.tsx` already shows `grand_total` per invoice and needs no changes here) and, by the same reasoning, it applies to Item Issue too, since Phase 5 already built a read-only issue log — Task 3 makes that explicit rather than silently building a redundant page.
- **No new migration:** confirmed via live `pg_policies` query that every table this phase reads already has a working SELECT policy (`products_select`, `inventory_po_select`, `inventory_po_items_select`, `inventory_grn_select`, `inventory_grn_items_select`, `inventory_suppliers_select`, `inventory_item_issues_select`) — this phase is UI-only.
- **No placeholders:** every card/column/filter is enumerated concretely; aggregation formulas are spelled out (not "add appropriate totals").
- **File-conflict risk:** Tasks 1 and 2 both touch `SalesLayout.tsx`/`App.tsx`, but since this phase runs as one sequential SDD cycle (not parallel forks, unlike Phase 3+5), each task's changes land one after the other with no merge conflict — no coordination needed.
