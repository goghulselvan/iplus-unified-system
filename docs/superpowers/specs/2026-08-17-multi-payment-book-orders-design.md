# Multiple Payments Per Book Order — Design

## Goal

`docs/superpowers/specs/2026-08-15-payment-verification-mismatch-design.md` deliberately kept book
orders (`product_orders`) single-payment: "book orders deliberately stay single-payment with
in-place editing instead" of a full ledger like registration payments has. Two days later, a real
order broke that assumption: St Joseph's Convent Anglo Indian Girls' Higher Secondary School
(`ORD/26-27/6`, ₹8,160 total) paid ₹8,140 in one UPI transaction and the remaining ₹20 in a
separate transaction. With only one payment-proof slot on the order, staff had no way to attach
both transactions' proof — the only tool available was to overwrite the declared amount by hand
with no record of what actually justified the correction.

This happens "occasionally" (confirmed with Goghul — a few times a month, not a one-off), so it's
worth structured support rather than another manual workaround. Scope, also confirmed: **staff-side
only, CRM repo only** — schools do not get a portal-side way to add a second payment; staff record
it when they become aware of it (phone/WhatsApp), matching how this actual case happened.

## Core mechanism: additional-payments table, single confirm-time tally

The existing `product_orders` payment fields (`payment_amount`, `payment_screenshot_url`,
`payment_utr_reference`, `payment_mode`, `payment_date`, `payment_account_holder_name`,
`verified_amount`, `payment_status`, `payment_review_note`) are **untouched** — they keep recording
the first/original transaction exactly as today, via the same intake paths
(`submit_product_order` from the portal, `create_manual_product_order` for staff-entered orders).
Neither of those RPCs changes, and neither repo's intake UI changes.

A new table, `product_order_payments`, holds only the *additional* transactions (2nd, 3rd, ...).
Staff adds a row per extra transaction with its own proof; nothing here has its own verified-amount
field — staff still reviews all the proof together and types **one** final trusted total at Confirm
time, same as today. Per-row verification would be more bookkeeping than the actual review process
needs, and duplicates a decision (verification) that only really happens once, at Confirm.

## Schema

```sql
CREATE TABLE public.product_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.product_orders(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  screenshot_url text NOT NULL,
  utr_reference text,
  payment_mode text,
  payment_date date,
  note text,
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_order_payments_order_id ON public.product_order_payments(order_id);
```

RLS: same shape as `product_orders` — staff (`is_crm_user()`) full access; no portal/anon policy at
all (portal has no reason to ever read or write this table, per the staff-only scope).

## New RPCs

**`add_order_payment(p_order_id uuid, p_amount numeric, p_screenshot_url text, p_utr_reference text, p_payment_mode text, p_payment_date date, p_note text)`**
- `is_crm_user()` gated.
- Only allowed while the parent order's `payment_status = 'pending'` — same restriction
  `update_order_payment_details` already uses, for the same reason: once confirmed, the payment
  record is locked, and re-opening it is `request_order_payment_resubmit`'s job (unchanged, still
  the tool for a hard rejection — different case from "more proof arrived for a real order").
- Inserts a row. `entered_by = auth.uid()`.

**`delete_order_payment(p_payment_id uuid)`**
- `is_crm_user()` gated, same pending-only restriction (checked via the parent order, joining
  through `order_id`).
- Lets staff remove a row added by mistake (misclick, duplicate) before confirming. No edit RPC —
  if a row is wrong, delete and re-add rather than patching fields in place; simpler surface for a
  rarely-used correction path.

**`confirm_product_order_payment` — no signature change, one behavior change**
- The RPC itself doesn't change: it still takes `p_verified_amount` as the one trusted figure staff
  types after reviewing everything, and stores it on `product_orders.verified_amount` exactly as
  today.
- What changes is **what the UI pre-fills that field with** (see below) — the tally happens
  client-side, as a suggestion, not server-side as a constraint. Staff can still type any number
  they actually believe after looking at the proof, same as today's soft-mismatch-warning approach
  from the 08-15 spec.

## UI — `OrderRequestDetail.tsx`

- **Payment Proof section**: below the existing single-screenshot card, a list of any additional
  payments (screenshot thumbnail, amount, UTR, date, note) each with a delete icon — visible only
  while `payment_status = 'pending'` (matches Update Payment's existing visibility rule at line
  ~273 today).
- **"Add Payment" button**, next to the existing "Update Payment" button — opens a new dialog
  (same field shape as Update Payment's dialog, minus the fields that don't apply per-transaction:
  amount, screenshot upload, UTR, mode, date, note). On save, calls `add_order_payment` and appends
  to the list without closing the page.
- **Confirm dialog's Verified Amount field**: currently pre-fills with `order.payment_amount`
  (`confirmVerifiedAmount` state, set in `openConfirmDialog`). Changes to pre-fill with
  `order.payment_amount + SUM(additionalPayments.map(p => p.amount))` — computed client-side from
  the already-fetched additional-payments list, still fully editable before confirming.
- **Mismatch badge** (line ~241 today: `⚠ Verified: ₹X` when `verified_amount !== payment_amount`)
  generalizes to compare against the same computed total instead of the bare `payment_amount`, so
  it doesn't fire a false "mismatch" for the ordinary case where verified correctly equals
  first-payment + additional-payments.
- **Order Requests list page**: currently shows `payment_amount` as the order's declared amount.
  Small follow-on tweak — show the summed total (main + additional) wherever an order with
  additional payments appears in the list, so staff aren't looking at a number that's silently
  incomplete. School Detail's "Book Orders" tab is unaffected (it deliberately shows no
  payment/financial info at all, per existing design).

## Error handling

- `add_order_payment`/`delete_order_payment` reject outside `payment_status = 'pending'` with a
  clear message ("Can only add/remove payments while the order is pending review") — same phrasing
  style as `update_order_payment_details`'s existing pending-only guard.
- Screenshot upload for an additional payment reuses the same `payment-proofs` storage bucket and
  upload path already used for the main payment and for `ManualOrderDialog` — no new storage
  policy needed, `crm_staff_upload_payment_proof` already grants staff write access there.
- Deleting a payment is a hard delete (no soft-delete/audit row) — acceptable since it's
  pending-only (nothing downstream has consumed the row yet) and staff can always re-add if needed.

## Testing

No automated test suite exists for this codebase's CRM UI (consistent with the rest of the Sales
module — verification has been via `tsc`, direct authenticated RPC calls, and live click-through).
Verification plan: `tsc --noEmit` clean; direct SQL exercise of `add_order_payment`/
`delete_order_payment`/`confirm_product_order_payment` against a real (non-production) order to
confirm the pending-only guards and the tally math; live click-through by Goghul before merge,
given manager/accountant click-through on this module is still an open item per
[[project_sales_module]] memory.

## Out of scope (explicitly not building)

- Portal-side self-service second payment — staff-only, per confirmed scope.
- Per-row verified amounts on `product_order_payments` — one trusted total at Confirm time only.
- Editing an existing additional-payment row — delete and re-add instead.
- Retroactively adding a payment to an already-`confirmed` order — if a shortfall is discovered
  after confirmation, that's a different (rarer) problem than this spec covers; today's tools
  (direct DB correction, or a future spec if this turns out to be common) still apply.
