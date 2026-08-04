# Inventory Module Rebuild (from reference School ERP) — Design

**Date:** 2026-08-04
**Status:** Drafted from chat discussion, pending Goghul's review

## Problem

The Sales module's Products page today is a flat rate-card: name, HSN/SAC, GST rate, unit
price, stock quantity. It has no categories, no per-item low-stock threshold (one hardcoded
global constant, 5 units, for all 48 products), no supplier/procurement tracking, no stock-in
history beyond the raw quantity number, and no way to issue stock without a paid sale.

Goghul has a reference School ERP (`v3.5/backend-web`, Laravel/PHP + MySQL — a different stack
entirely, so nothing is copied verbatim; the data model and workflow are what's being ported)
whose Inventory module covers this properly: richer items, categories, suppliers, purchase
orders with goods-received reconciliation, multiple stock-movement types, sales, item issuance,
and reporting. Goal: rebuild the full feature set natively in our stack (React + Supabase/
Postgres), reusing our existing `products`/`invoices` tables rather than forking them.

**Explicitly out of scope:** a dedicated refund/return workflow and the ERP's general
Complaints ticket system — neither actually exists as a purpose-built inventory feature in the
reference app (checked directly: no refund model anywhere in their Inventory module; Complaint
is a separate Front Office feature unrelated to stock). Dropped per Goghul's own call.

## Guiding Principle

**Extend, don't fork.** `products` stays `products` — it's already referenced by `invoices`,
`invoice_line_items`, and the existing UI. Every phase below adds columns/tables around it
rather than replacing it, so nothing already live (Sales module, GST invoicing, the stock
counts just imported from the CSV) breaks or needs migrating to a new identity.

**Confirmed while scoping:** `create_invoice`/`update_invoice` (in `20260728_sales_module.sql`)
already decrement/restore `products.stock_quantity` on every sale and edit, with delta-based
adjustment and warn-don't-block on insufficient stock. This means Phase 4 (Sales integration)
does NOT need a new sales engine — the existing one already does the core job. It only needs to
keep working cleanly against the richer item model added in Phase 1.

## Phase Breakdown (build order = dependency order)

### Phase 1 — Items & Categories (foundation, blocks everything else)

New table `product_categories`: `id`, `name`, `description`, `is_active`.

Extend `products` with: `category_id` (FK, nullable — existing 48 rows start uncategorized),
`sku` (nullable, unique per active row), `item_type` (`consumable` | `saleable`, default
`saleable` — all 48 existing books/mock-tests are `saleable`), `unit` (default `'pcs'`),
`minimum_stock_level` (integer, default 5 — replaces the hardcoded `LOW_STOCK_THRESHOLD`
constant with a per-product value; existing global badge logic becomes `stock_quantity <
minimum_stock_level`), `expiry_date` (nullable — not meaningful for books, but needed for any
future consumable line), `location` (nullable, free text), `barcode` (nullable), `image_url`
(nullable).

Products page gets: category filter, item-type filter, search by name/SKU, and the
Series/Subject/Class filters + Series/Subject dropdown-with-custom-entry already discussed
earlier this session (that work folds into this phase rather than shipping separately first).

### Phase 2 — Procurement: Suppliers, Purchase Orders, GRN, Supplier Payments

New tables: `inventory_suppliers` (name, contact person, phone, email, address, GSTIN,
is_active), `inventory_purchase_orders` (supplier_id, order_date, expected_date, status:
draft/ordered/partially_received/received/cancelled, notes, created_by), `inventory_po_items`
(purchase_order_id, product_id, quantity_ordered, unit_cost), `inventory_grn` (goods received
note: purchase_order_id, received_date, received_by, notes), `inventory_grn_items` (grn_id,
po_item_id, quantity_received — can be less than ordered, that's the point), and
`inventory_supplier_payments` (supplier_id, amount, payment_date, payment_mode, reference,
notes). Receiving a GRN item increments `products.stock_quantity` by `quantity_received`.

### Phase 3 — Stock Movements: Stock Add & Stock Adjustment

New tables: `inventory_stock_adds` (product_id, quantity, reason, added_by, date — stock-in
outside a PO, e.g. a manual top-up) and `inventory_stock_adjustments` (product_id, quantity_delta
signed +/-, reason required, adjusted_by, date, reversible/deletable — deleting an adjustment
reverses its effect on `stock_quantity`, mirroring the reference app's behavior, with the same
guard against a reversal driving stock negative).

### Phase 4 — Sales integration (light — existing engine already does the core work)

No new tables. Verify `create_invoice`/`update_invoice`/`void_invoice` continue to work
unchanged against the Phase-1-extended `products` table (typecheck + build clean; RPCs
reference `products` by id/columns that aren't being removed, only added to, so this should be
a non-event — but it's the phase where a regression would most likely surface, so it gets an
explicit verification pass rather than being assumed safe).

### Phase 5 — Item Issue

New table `inventory_item_issues`: product_id, issued_to_type (`student` | `staff` | `other`),
issued_to_name, quantity, issued_by, issue_date, notes. Decrements `products.stock_quantity`
the same way a sale does, but with no invoice/payment attached — for internal consumption
(e.g., handing out consumables) rather than a billed sale.

### Phase 6 — Reports

New page(s) under Sales: Stock Report (current level vs `minimum_stock_level`, flags anything
below threshold), Purchase Report (PO/GRN history per supplier), Item Issue Report. Sales
reporting itself already partially exists on the Invoices page; extend rather than duplicate.

## Data Model Summary

All new tables: `id uuid` PK, `created_at`/`updated_at`, RLS via `is_crm_user()` matching every
other CRM table's existing pattern (role-agnostic read/write at the RLS layer, same as the rest
of this CRM — Sales module's one exception, the Manager invoice restriction, was enforced
inside the RPC body, not RLS; the same approach applies here if a role restriction is ever
requested, but none has been asked for on inventory specifically).

## Build & Verification Approach

Each phase: migration → RPCs (where a phase needs one, e.g. `receive_grn`, `create_stock_adjustment`)
→ UI page under `src/pages/Sales/` following `ProductsPage.tsx`'s existing conventions (same
component library, same layout shell) → `npx tsc --noEmit` + `npm run build` clean → verify via
direct-authenticated-SQL-session calls (no CRM login available in this environment, per
[[feedback_no_crm_login_verify_via_cli]] — Goghul click-through-tests visually afterward).

Phases 2-6 depend on Phase 1's schema existing; within that constraint, phases are built and
shipped one at a time in the order above, each ending in a working, typechecked, deployed state
before the next starts — not a single big-bang migration at the end.
