# Accounts Module — Design

## Goal

The `accountant` role exists (DB enum, 0 users assigned today) but has almost nothing to do: one
page (`/accountant`) showing registration-fee payments only. Everything else money-related —
Sales/book-order payments, supplier payments, credit notes, refunds, outstanding balances — is
either invisible to them or requires navigating a Sales module they have no nav entry into. This
builds a real Accounts area: one place an accountant (or superadmin) goes to see every payment in
and out of the business, plus refunds, credit notes, and outstanding balances — money in, money
out, and everything in between.

This is independent of, and depends on, the Returns & Exchanges feature
(`docs/superpowers/specs/2026-08-21-returns-exchanges-design.md`) — that feature's Credit Notes /
Refund History page is the credit-notes-and-refunds piece of this module; this spec links to it
rather than rebuilding it. That feature must be merged into `main` before this one ships (tracked
separately).

## Scope

**In scope:**
- A new top-level module (`/accounts/*`), its own nav, gated to `accountant` + `superadmin` only.
- A Dashboard with the headline numbers.
- A unified **Payments** ledger: every money-IN transaction (registration fees + book-order
  payments) in one filterable table.
- A **Supplier Payments** page: every money-OUT transaction (stock purchases), which today only
  exists scattered per-purchase-order with no cross-supplier view.
- A **Credit Notes & Refunds** nav entry pointing at the existing (post-merge) `/sales/credit-notes`
  page — no duplicate UI.
- An **Outstanding** page: schools with unpaid/partial registration balances, combined with
  book orders sitting invoiced-but-unpaid.
- A **Deleted Payments** page: browse UI for the existing `deleted_payments` audit table (table and
  triggers already exist, RLS already permits `is_crm_user()` SELECT, no UI has ever been built).

**Out of scope, deliberately:**
- Rebuilding Credit Notes/Refunds UI — the Sales module's `/sales/credit-notes` page already does
  this (once merged); this module links to it.
- Any new write actions beyond what already exists — this module is a **visibility and navigation
  layer**, not new business logic. Refunds are issued from `/sales/credit-notes` (already built),
  supplier payments are recorded from the existing Purchase Order flow, registration payments from
  the existing Payment tab/Payment Queue. Nothing here mutates money.
- A single mega-ledger mixing money-in and money-out in one table. Schools (payers) and suppliers
  (payees) are different entity types with different columns worth filtering on (district/state vs.
  supplier name) — two focused lists serve an accountant better than one table with half its
  columns blank depending on direction. The Dashboard is where the combined net-position number
  lives.
- Changing who can act on Sales invoices/refunds/stock — those role gates (`superadmin`/`accountant`
  for money actions, open-to-any-staff for order intake) are untouched; this module only adds a new
  place to *see* the results.

## Core mechanism

No new business data is created by this feature — every number already exists somewhere in
`payment_transactions`, `product_orders`, `inventory_supplier_payments`, `credit_notes_with_balance`,
`credit_note_applications`, `deleted_payments`, or `schools`. This module is:
1. One new precisely-scoped role-check helper (existing `is_accountant_or_above()` is a footgun for
   this — see below).
2. One new normalizing view for the unified Payments-In ledger.
3. New pages that read the above (and existing tables/views) — no new RPCs, since nothing here
   writes.

### The `is_accountant_or_above()` naming trap

`is_accountant_or_above()` already exists in this database — but despite the name, it returns true
for `manager` too (`role IN ('accountant', 'manager', 'superadmin')`). The Sales module's real
money-gated RPCs (`invoices_update`, `confirm_return_received`, `issue_credit_refund`, etc.)
deliberately avoid it and inline `role IN ('superadmin', 'accountant')` instead — the codebase's
established, correct precedent, confirmed by reading every one of those RPCs directly. This module
needs the same accountant+superadmin-only (no manager) gate in several places, so rather than
inline the same three-role check repeatedly or accidentally reach for the misleadingly-named
existing helper, add one new precisely-named function:

```sql
CREATE OR REPLACE FUNCTION public.is_accountant_or_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('accountant', 'superadmin')
  );
$function$;
```

Used in the RLS policies on the new view below and on `deleted_payments`'s existing policy is
untouched (it already correctly uses `is_crm_user()` — any staff — which this module doesn't need
to narrow, since restricting *page access* is enough; the underlying table staying broadly readable
by any CRM query is pre-existing behavior, not something this feature should tighten unasked).

### Unified Payments-In view

```sql
CREATE VIEW public.accounts_payments_in
WITH (security_invoker = true) AS
SELECT
  pt.id,
  'registration'::text AS category,
  pt.payment_date AS transaction_date,
  pt.school_id,
  s.school_name,
  s.ss_no,
  pt.payment_amount AS amount,
  pt.payment_mode,
  pt.transaction_reference AS reference,
  pt.created_by,
  pt.created_at
FROM payment_transactions pt
JOIN schools s ON s.id = pt.school_id
UNION ALL
SELECT
  po.id,
  'book_order'::text AS category,
  po.payment_date AS transaction_date,
  po.school_id,
  s.school_name,
  s.ss_no,
  po.payment_amount AS amount,
  po.payment_mode,
  po.payment_utr_reference AS reference,
  po.created_by,
  po.created_at
FROM product_orders po
JOIN schools s ON s.id = po.school_id
WHERE po.payment_status = 'confirmed';
```

**Dedup note, verified directly against the live RPC**: a portal-submitted registration payment
only ever reaches `payment_transactions` once staff acknowledges it —
`acknowledge_portal_payment()` inserts the `payment_transactions` row itself at acknowledgment time.
`portal_payment_submissions` is the intake queue (pending/rejected/resubmit never appear here at
all); reading only `payment_transactions` for the registration side is correct and cannot
double-count. Book-order payments have no separate installment/transaction table — one
`product_orders` row is one payment event — so filtering to `payment_status = 'confirmed'` is the
complete and correct set with no dedup risk.

`security_invoker = true` is mandatory — a prior feature in this codebase (the inventory rebuild)
shipped a summary view without it and it silently bypassed RLS. Same class of mistake this repo has
already made once; not repeating it.

RLS: `is_accountant_or_superadmin()` SELECT-only, no write policy (nothing ever writes to a view).

### Supplier Payments — no new view needed

`inventory_supplier_payments` (id, supplier_id, amount, payment_date, payment_mode, reference,
notes, created_by, created_at) is already a clean single table with one row per payment — the page
just joins it to `suppliers` for the name and lists it directly. Building a parallel view here would
be an unneeded abstraction over a table that's already exactly the right shape.

### Outstanding

Two independent sources, shown as two sections on one page (not merged into one table — a school
owing a registration balance and a school with an unpaid book-order invoice are different kinds of
debt with different resolution paths):
- **Registration outstanding**: `schools` where `payment_status NOT IN ('Received', 'Overpaid')`,
  showing `outstanding_balance`.
- **Book-order outstanding**: `invoices.status NOT IN ('paid', 'void')`. Checked live data directly:
  every `product_order_items.line_status` today is `paid`, `dispatched`, or `rejected` — no
  `pending`/`invoiced_unpaid` rows exist, and `invoices.status` is only ever `paid` or `void` in
  practice, because `approve_order_items` auto-marks the invoice paid at creation (book orders
  require full payment — cash or credit-covered — before submission, unlike registration fees which
  explicitly support partial/installment payment). So this section is expected to show **empty
  today**, but the query stays in place since the schema (and the `mark_invoice_paid` RPC) still
  allow a not-yet-paid invoice to exist — this section is correct now and stays correct if that
  ever changes, rather than hardcoding an assumption that book orders are always fully paid.

### Deleted Payments page

Straight list over the existing `deleted_payments` table (already has `school_id`, `source_table`,
`amount`, `payment_mode`, `payment_date`, `reference`, `deleted_by`, `deleted_at` — see
`supabase/migrations/20260821_deleted_payments_audit.sql`), joined to `schools` for the name. A
`deleted_by IS NULL` row is rendered distinctly (e.g. "outside normal flow") — that's the existing,
deliberate signal that a delete bypassed the app entirely (dashboard/SQL-editor), not a bug to hide.

## UI

- **`ModuleSelect.tsx`** — new "Accounts" tile, shown only when `profile?.role === 'accountant' ||
  profile?.role === 'superadmin'` (the other three tiles stay unconditional, matching existing
  behavior — this one is new and money-scoped, so it should not dead-end a manager who clicks it).
- **New `AccountsLayout.tsx`** (mirrors `SalesLayout.tsx`'s pattern) — nav: Dashboard, Payments,
  Supplier Payments, Credit Notes & Refunds (external link to `/sales/credit-notes`), Outstanding,
  Deleted Payments.
- **Routes** (`App.tsx`): `/accounts/dashboard`, `/accounts/payments`, `/accounts/supplier-payments`,
  `/accounts/outstanding`, `/accounts/deleted-payments` — each wrapped in the **existing**
  `<ProtectedRoute accountantOnly>` (already does exactly `role === 'accountant' || role ===
  'superadmin'`, confirmed by reading `ProtectedRoute.tsx` directly — no new prop needed).
- **`AccountsDashboardPage.tsx`** — KPI cards: Total Collected (registration + book orders, this FY),
  Total Paid to Suppliers, Net Position, Outstanding from Schools, Open Credit Note Balance (sum of
  `credit_notes_with_balance.remaining_balance`), Pending Payment Reviews (count of pending
  `portal_payment_submissions` + pending book-order payment reviews, combined).
- **`AccountsPaymentsPage.tsx`** — table over `accounts_payments_in`: date range filter, category
  filter (registration/book order), school search, CSV export (reuse `downloadCSV` util already used
  by `useAccountantDashboard.ts`). Each row deep-links: registration → School Detail Payment tab,
  book order → the invoice/order.
- **`AccountsSupplierPaymentsPage.tsx`** — table over `inventory_supplier_payments` joined to
  `suppliers`: date range, supplier filter, CSV export. Row links to the Purchase Order.
- **`AccountsOutstandingPage.tsx`** — two sections as described above.
- **`AccountsDeletedPaymentsPage.tsx`** — table over `deleted_payments` joined to `schools`.

## Error handling

Nothing here writes, so the main failure mode is a query error on load — every page follows the
existing Sales-module pattern already used throughout this codebase (loading skeleton → error state
with retry → empty state with a clear message, no raw error text ever surfaced to the user).

## Testing

No automated test suite exists in this codebase (established convention, same as Returns &
Exchanges). Verification plan: `tsc --noEmit` clean; direct query against
`accounts_payments_in`/the new role helper on the live linked database to confirm row counts and
role-gating actually work (a manager session should get zero rows / a redirect, an accountant
session should see everything); live browser click-through by Goghul before merge (this environment
has no CRM login).

## Out of scope (explicitly not building)

- New write/action RPCs — this is a visibility layer, not a new business-logic surface.
- A combined money-in/money-out ledger table.
- Any change to who can *act* on money (refund, void, adjust stock) — only who can *see* rollups.
- Portal-side changes — this is CRM-staff-only, same boundary Returns & Exchanges already drew.
