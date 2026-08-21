# Returns & Exchanges — Design

## Goal

Two real, recurring cases have no clean tool today:

1. **Fulfillment error** — the wrong book got picked/packed and shipped to a school.
2. **Manual-order data-entry error** — staff created a Manual Order Request for the wrong
   class/subject book; the school received something they never ordered.

Both are "on us," not the school's mistake. The school sends the wrong book back, and the correct
one needs to go out — across possibly-multi-item orders, without ever losing track of which
specific line item is coming back, without silently re-billing the school for our own error, and
without the original invoice's numbers ever changing after the fact (matches the existing
Void ≠ Delete philosophy already used for invoices in this module — never mutate a historical
financial document, always create a new correcting one).

## Scope

**In scope:** returns against invoice line items that were billed to a real `schools` row via the
Book Order Requests pipeline (portal orders or Manual Order Requests) — i.e. every invoice this
applies to has `invoices.school_id` set. Both the original two cases above, plus a third real
variant surfaced during design: an item arrives **damaged in transit** (not wrong, just broken).

**Out of scope, deliberately:**
- Invoices billed to a `prospect_school_id` (Book Order Requests never target prospects — this
  whole feature inherits that same real-school-only boundary, no new machinery needed to enforce
  it, "Report Return" simply isn't offered on a prospect-billed invoice).
- **Excess/unbilled quantity** (school got 6 copies but was only invoiced for 5) — nothing was
  charged for the 6th, so it isn't a financial return at all. When it comes back, it's a plain
  stock correction — the existing Stock Movements → Add Stock feature (from the inventory rebuild)
  already covers this. Not building a parallel path for it here.
- A formal Credit Note PDF — CRM record only for now (Goghul's call; add a PDF later if it's ever
  actually needed for a school's own books).
- Any new WhatsApp/email templates — no new automated notification for v1. The only place this is
  ever customer-visible automatically is the *existing* dispatch notification firing when the
  replacement order is marked dispatched, which already works today and needs no changes.
- Portal-side visibility of returns/credit — staff-only (CRM) for v1.
- Applying credit at portal checkout — credit application only ever happens staff-side, at Manual
  Order Request creation (see below). Not touching the live portal payment/checkout flow.

## Core mechanism

Three new tables. The original invoice and its `invoice_line_items` are **never edited** — a
return is tracked as an overlay row referencing the line item, and money is corrected through a
**Credit Note**, a separate, numbered document (mirrors how `invoices` are numbered) that can later
be applied to a new invoice or refunded in cash.

```
invoice_line_items (existing, untouched)
        ▲
        │ invoice_line_item_id
product_returns  →  credit_notes  →  credit_note_applications
  (requested/           (numbered,        (→ a later invoice,
   received)              per-FY)           or → a cash refund)
```

## Schema

```sql
-- One row per returned line item (or partial quantity of one).
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
CREATE INDEX idx_product_returns_invoice_line_item_id ON public.product_returns(invoice_line_item_id);
CREATE INDEX idx_product_returns_status ON public.product_returns(status);

-- One row per resolved return, numbered per-FY exactly like invoices.
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
CREATE INDEX idx_credit_notes_school_id ON public.credit_notes(school_id);

CREATE TABLE public.credit_note_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);

-- Every use of a credit note: applied to a later invoice, or refunded in cash.
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
CREATE INDEX idx_credit_note_applications_credit_note_id ON public.credit_note_applications(credit_note_id);

-- Remaining balance is always computed, never stored — avoids a second source of truth that can
-- drift (the exact bug class Phase 2's RLS-bypass view fix and Phase 3's concurrency fixes were
-- both guarding against). security_invoker is mandatory here: Phase 2 of the inventory rebuild
-- shipped a summary view without it and it silently bypassed RLS — not repeating that.
CREATE VIEW public.credit_notes_with_balance
WITH (security_invoker = true) AS
SELECT cn.*,
  cn.amount - COALESCE((
    SELECT SUM(ca.amount) FROM credit_note_applications ca WHERE ca.credit_note_id = cn.id
  ), 0) AS remaining_balance
FROM credit_notes cn;

-- Manual Order Requests can carry an applied credit from creation through invoicing.
ALTER TABLE public.product_orders
  ADD COLUMN applied_credit_note_id uuid REFERENCES public.credit_notes(id),
  ADD COLUMN applied_credit_amount numeric CHECK (applied_credit_amount IS NULL OR applied_credit_amount > 0);

-- Screenshot proof stays required in every normal case; only a fully-credit-covered manual order
-- has nothing to prove. Portal intake (submit_product_order) is untouched and its UI keeps the
-- upload mandatory in practice — this relaxes the column, not the portal's own requirement.
ALTER TABLE public.product_orders ALTER COLUMN payment_screenshot_url DROP NOT NULL;
```

RLS on all four new tables/view: `is_crm_user()` SELECT only, same shape as `product_orders`/
`invoice_line_items` — no direct INSERT/UPDATE/DELETE policy anywhere. Every write goes through a
SECURITY DEFINER RPC below, so a raw client write is impossible regardless of role.

## New RPCs

**`report_return(p_invoice_line_item_id uuid, p_quantity integer, p_reason_category text, p_reason_note text)`**
- `is_crm_user()` gated — any staff can log that a return is coming.
- Resolves the parent invoice via the line item; rejects if that invoice's `school_id IS NULL`
  (prospect-billed) or the invoice is `void`.
- Validates `p_quantity > 0` and, critically: `SUM(existing product_returns.quantity for this
  invoice_line_item_id) + p_quantity <= invoice_line_items.quantity` — a line can never have more
  returned against it than was actually billed on it. This is what makes the "5 sent, 1 damaged"
  case safe: the other 4 stay untouched and nothing can later double-return them.
- Inserts the row, `status = 'requested'`.

**`confirm_return_received(p_return_id uuid, p_condition text)`**
- Gated `role IN ('superadmin', 'accountant')` — same inline check already used on
  `invoices_update`/`invoices_delete` (deliberately excludes manager, since this mints money-value
  documents and adjusts stock, same class of action as void/edit).
- Requires the return to be `status = 'requested'`; `p_condition IN ('resellable', 'damaged')`,
  required every call — no default.
- If `resellable`: atomically restores stock — `UPDATE products SET stock_quantity =
  stock_quantity + v_quantity WHERE id = v_product_id RETURNING stock_quantity` — the same
  atomic-write pattern Phase 3's stock-adjustment concurrency fix established, not a
  read-then-check-then-write.
- If `damaged`: no stock change (written off).
- Mints the credit note: `credit_amount = return.quantity * invoice_line_items.unit_price` (the
  actual billed price at time of sale, read from the immutable snapshot — never the current
  catalog price, which may have since changed), next `credit_note_number` via
  `credit_note_fy_counters` using the same atomic per-FY counter pattern as
  `invoice_fy_counters`/`generate_receipt_number()`, `school_id` copied from the invoice.
- Updates the return: `status = 'received'`, `condition_on_receipt`, `received_by`, `received_at`.

**`create_manual_product_order` — extended, not replaced**
- New optional params `p_credit_note_id uuid`, `p_credit_amount numeric`.
- If provided: validates the credit note's `school_id` matches `p_school_id`, and `p_credit_amount
  <= credit_notes_with_balance.remaining_balance` and `<= ` the order's own subtotal (never applies
  more credit than the order is worth). Stores both on the new `product_orders` row.
- Required `payment_amount` from the school becomes `subtotal - p_credit_amount`; if that's `0`,
  the RPC accepts a null `payment_screenshot_url` — otherwise the screenshot stays required exactly
  as today.

**`approve_order_items` — one addition**
- After creating the invoice (unchanged logic otherwise): if the source order has
  `applied_credit_note_id` set, insert one `credit_note_applications` row
  (`application_type = 'invoice'`, `applied_to_invoice_id` = the new invoice's id, `amount =
  applied_credit_amount`).

**`issue_credit_refund(p_credit_note_id uuid, p_amount numeric, p_refund_mode text, p_refund_reference text, p_note text)`**
- Same `role IN ('superadmin', 'accountant')` gate as `confirm_return_received`.
- Validates `p_amount > 0` and `<= credit_notes_with_balance.remaining_balance`.
- Inserts a `credit_note_applications` row, `application_type = 'refund'`. Supports partial
  refunds — the rest of a credit note's balance can stay open for a future order.

## UI

- **`InvoiceItemsDialog.tsx`** — new "Report Return" action per line item (hidden entirely when
  the invoice's `school_id IS NULL`, matching the prospect-exclusion above). Small dialog: quantity
  (capped at what's left un-returned on that line), reason category dropdown, optional note. Calls
  `report_return`.
- **New `ReturnsPage.tsx`** (`/sales/returns`) — "Requested" / "Received" tabs, mirrors the existing
  Order Requests page pattern. Each "Requested" row gets a "Confirm Receipt" action
  (superadmin/accountant only, same visibility rule as Stock Movements' role-gated buttons): a
  condition radio (Resellable / Damaged, no default) → `confirm_return_received`.
- **New `CreditNotesPage.tsx`** (`/sales/credit-notes`) — "Open" tab (every credit note with
  `remaining_balance > 0` from `credit_notes_with_balance`: school, amount, balance, link back to
  the source return) with an "Issue Refund" button per row (superadmin/accountant only, opens a
  dialog for amount/mode/reference/note) → `issue_credit_refund`. "Refund History" tab lists every
  `credit_note_applications` row where `application_type = 'refund'` — amount, mode, reference,
  who, when. This is the refunds list you asked for.
- **`ManualOrderDialog.tsx`** — once a school is selected, if it has any open credit balance, show
  it with an optional "Apply Credit" amount input (capped at `min(balance, order subtotal)`). The
  payment-proof upload's "required" marker becomes conditional: optional only when applying credit
  brings the net amount due to exactly `0`.
- **Sales nav** — new "Returns" dropdown (Returns, Credit Notes), same `DropdownMenu` pattern
  already used for Procurement/Inventory/Reports.

## Error handling

- Over-returning a line (`report_return`) fails with a clear message naming how much is actually
  left un-returned on that line, not a generic constraint violation.
- `confirm_return_received` on an already-received return, or `issue_credit_refund` over the
  remaining balance, both fail with a specific message rather than a bare check-constraint error.
- Stock restoration on receipt uses the atomic `UPDATE ... RETURNING` pattern specifically because
  two staff confirming two different damaged/resellable returns on the same product concurrently
  must not race — same class of bug Phase 3 already had to fix once in this module.

## Testing

No automated test suite exists for this CRM (consistent with the rest of Sales). Verification
plan: `tsc --noEmit` clean; direct authenticated-session RPC calls exercising the full loop (report
→ confirm receipt with each condition → credit note minted with correct amount → apply partial
credit on a new Manual Order Request → issue a partial refund on the remainder → balance reaches
`0`); over-return and over-refund guards explicitly tried and confirmed to fail correctly; live
click-through by Goghul before merge — manager/accountant click-through on the rest of this module
is still an open item per `project_sales_module` memory, so superadmin-only verification here
should be flagged the same way, not assumed to cover every role.

## Out of scope (explicitly not building)

- Prospect-billed invoices (see Scope above).
- Excess/unbilled quantity handling — existing Stock Movements → Add Stock covers it.
- Credit Note PDF generation.
- New WhatsApp/email templates for return/credit events.
- Portal-side return visibility or self-service credit application.
- A three-state or courier-tracked return lifecycle (in-transit, etc.) — no courier-tracking
  integration exists in this system to justify it; two states (requested/received) is the honest
  model for how this business actually operates today.
