# Book Order Requests (CRM/Sales side) — Design

## Goal

Let schools order books through the portal; those orders land as "Order Requests" in the Sales module for staff to review, confirm payment, invoice, and dispatch. This spec covers the **CRM side only** — the shared DB schema, RPCs, and a new standalone Sales module page. The portal-side ordering UI is a separate spec (`iplus-olympiad-spark` repo), built after this one ships, since it depends on the RPCs defined here.

Both apps share the same Supabase project (`eucjeggfclztkbbupaav`), so no sync mechanism is needed — the portal writes directly through the RPCs this spec defines, using its existing `get_portal_school_id()` auth pattern (already used by `bulk_register_students_portal` and similar school-submitted writes).

Full interactive flowchart worked out with Goghul: [order-flow.html artifact] (referenced for context; this doc is the authoritative written version).

## Data model

**`product_orders`** — one row per school's cart submission.
- `id uuid PK`, `school_id uuid NOT NULL REFERENCES schools(id)`, `notes text`
- Payment proof, captured at submission time (same fields as the existing `portal_payment_submissions` convention): `payment_amount numeric NOT NULL`, `payment_mode text NOT NULL`, `payment_date date NOT NULL`, `payment_utr_reference text`, `payment_account_holder_name text`, `payment_screenshot_url text NOT NULL`
- `payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','confirmed','resubmit_requested'))`
- `payment_review_note text` — staff's reason when requesting resubmit (required, mirrors invoice-void's required-reason convention)
- `payment_reviewed_by uuid`, `payment_reviewed_at timestamptz`, `confirmed_at timestamptz`
- `created_at timestamptz NOT NULL DEFAULT now()`
- **No stored order-level fulfillment status** — that's always derived live from the line items (a stored rollup would drift; this project has hit that exact bug class before and the fix each time was "compute it, don't store it").

**`product_order_items`** — one row per product in the order.
- `id uuid PK`, `order_id uuid NOT NULL REFERENCES product_orders(id)`, `product_id uuid NOT NULL REFERENCES products(id)`
- `quantity integer NOT NULL CHECK (quantity > 0)`
- `unit_price numeric NOT NULL` — snapshotted from `products.unit_price` at order time, so a later price change never retroactively alters what the school agreed to pay
- `line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN ('pending','invoiced_unpaid','paid','dispatched','rejected'))`
- `invoice_id uuid REFERENCES invoices(id)` — nullable, set once this line is invoiced. One order can produce more than one invoice over time (if a rare stock issue holds one line back while others proceed), but **one invoice never mixes line items from two different orders**.
- `rejected_reason text`, `rejected_by uuid`, `rejected_at timestamptz`

**`invoices`** gets one new column: `dispatched_at timestamptz` (nullable) — set by the new "Mark as Dispatched" button on the Invoice page. Unused/null for every invoice not created from an order — harmless no-op for the rest of the Sales module.

## Stock handling: gate at order time, not review time

This is the key simplification that came out of design discussion. Rather than accepting any order and sorting out availability later:

- **Out of stock (0 available):** not orderable at all — the portal's Add to Cart is disabled for that product.
- **Low stock (available but below the restock threshold):** orderable, but the portal's quantity stepper is **capped at the live available quantity** — a school can never submit an order for more than what currently exists. `submit_product_order` re-validates this server-side (never trust a client-side cap alone).

Because of that cap, a line item can only become unfulfillable *after* being ordered in a genuine edge case: two schools racing for the same last few copies, or a stock-count correction. That's what **Reject** is for — not a routine "wait for restock" queue, an exception path for when the numbers didn't hold up between order and review. There is deliberately no "hold and wait for restock, retry later" state machine — it would add real complexity for a case the order-time cap already prevents in the common path.

## RPCs

All SECURITY DEFINER, `SET search_path = public`, `is_crm_user()` (staff RPCs) or `get_portal_school_id()` validation (portal RPCs) as the first check — same convention as every other RPC in this Sales module.

- **`submit_product_order(p_school_id, p_items jsonb, p_payment_mode, p_payment_date, p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url, p_notes) RETURNS uuid`** — portal-side. Validates `p_school_id = get_portal_school_id()`. Re-validates each item's quantity against live `products.stock_quantity`. Inserts the order + items (snapshotting `unit_price`). Returns the new order id.
- **`confirm_product_order_payment(p_order_id) RETURNS void`** — staff-side. Sets `payment_status='confirmed'`, `confirmed_at=now()`.
- **`request_order_payment_resubmit(p_order_id, p_reason) RETURNS void`** — staff-side. `p_reason` required (mirrors invoice void). Sets `payment_status='resubmit_requested'`, `payment_review_note=p_reason`.
- **`resubmit_product_order_payment(p_order_id, p_payment_mode, p_payment_date, p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url) RETURNS void`** — portal-side. Only allowed when `payment_status='resubmit_requested'` and the order belongs to the caller's school. Overwrites the payment fields, resets `payment_status='pending'`.
- **`approve_order_items(p_order_id, p_item_ids uuid[]) RETURNS uuid`** (invoice id) — staff-side. Requires `payment_status='confirmed'`. Requires every selected item to be `line_status='pending'` and still within live stock (the rare-case re-check). Builds the `p_line_items` jsonb from the selected rows and calls the existing `create_invoice` RPC directly (school_id from the order) — this reuses the already-reviewed invoicing logic rather than duplicating it. Sets those items' `invoice_id` + `line_status='invoiced_unpaid'`.
- **`reject_order_items(p_order_id, p_item_ids uuid[], p_reason) RETURNS void`** — staff-side. `p_reason` required. Only allowed on `pending` items. Sets `line_status='rejected'`, `rejected_reason`, `rejected_by`, `rejected_at`.
- **`mark_invoice_dispatched(p_invoice_id) RETURNS void`** — staff-side, called from the Invoice page's new "Mark as Dispatched" button. Requires the invoice's `status='paid'` (payment-gated dispatch — matches the whole point of this design: don't ship before payment is confirmed). Sets `invoices.dispatched_at=now()`, cascades every `product_order_items` row with that `invoice_id` from `paid` to `dispatched`.

**Trigger, not client sync:** when an invoice's `status` transitions to `'paid'` (via the existing `mark_invoice_paid` RPC, unchanged), a trigger flips its linked `product_order_items.line_status` from `invoiced_unpaid` to `paid`. This is the payment gate the school-visible "Order Confirmed → per-item status" flow depends on — it must be a trigger, not a second manual step, per this project's established DB-trigger-over-client-sync lesson.

## Sales module: new "Order Requests" page

Standalone nav entry (not folded into a dropdown — Goghul's explicit call). List view: one row per order — school name, item count, payment-status badge, and a rollup of line statuses ("2 invoiced · 1 paid · 1 dispatched"), computed live from `product_order_items`, same pattern `StockReportPage`'s summary cards already use.

Order detail view: payment proof image (viewable full-size), payment fields, and the two staff actions while `payment_status='pending'` — **Confirm Order** / **Request Resubmit** (reason required). Once confirmed: a table of line items, each with product/quantity/price/live-stock/status, checkboxes for **Approve → Create Invoice** (only enabled on rows that are still `pending` and in stock) and **Reject** (reason required). The resulting invoice(s) appear in the existing Invoices page as normal — the new "Mark as Dispatched" button lives there, on the invoice, not on the order page.

## Verification approach

Same as every prior phase: `npx tsc --noEmit` + `npm run build` clean, plus direct SQL smoke tests for every RPC (before/after/cleanup discipline) — including a deliberate concurrency check on `approve_order_items`' stock re-validation, given this project has twice found real TOCTOU races in stock-adjustment RPCs built the same way. No CRM login in this dev environment — Goghul click-throughs the Order Requests page and the portal separately once each side ships.

## Explicitly out of scope for this spec

- The portal-side ordering UI (separate spec, built next).
- Any change to `create_invoice`, `mark_invoice_paid`, or any other existing Sales RPC beyond the one new trigger and the one new `invoices.dispatched_at` column.
- A "hold and wait for restock, retry" state machine — deliberately not built, per the stock-gating decision above.
- Re-request flow for rejected items — rejected is terminal; a school places a new order if still wanted.
