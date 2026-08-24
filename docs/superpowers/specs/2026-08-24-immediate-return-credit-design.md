# Issue Credit Immediately on Return Report — Design

## Goal

Today, a Credit Note is only minted at "Confirm Receipt" — after the wrong book has physically
come back. For a fulfillment mistake, that's backwards: the school needs the *correct* book now
(it's iPlus's error, or even if it's the school's, the book matters to the student), and waiting
for the wrong one to complete its return journey before the school can get credit toward the
replacement just delays the thing that actually matters. This splits "confirm receipt" into two
independent steps so the credit can move immediately, while stock still only corrects once the
physical book is actually back.

## Scope

**In scope:** replacing the single "Confirm Receipt" action (mint credit + fix stock, both at once)
with two independent, sequential actions — **Issue Credit** (immediate, money only) and **Mark
Received** (later, stock only). Applies to every return, not just `wrong_item_shipped` — this is a
general timing change to the whole feature, not a special case.

**Out of scope, deliberately:**
- Any new way to *skip* issuing credit and go straight to marking received — the new sequence is
  mandatory (credit first, receipt confirmation second), matching how the business actually wants
  to operate. Not building an alternate path nobody asked for.
- Any change to *who* can report a return (`report_return` stays `is_crm_user()` — any staff, unchanged).
- Any change to the wrong-item-shipped stock-routing logic just built — `mark_return_received`
  reuses it exactly (`COALESCE(actual_product_id, invoiced product_id)`), just relocated out of the
  function that used to also mint the credit.
- Undoing/reversing an issued credit if the book never comes back — a real risk this design
  accepts deliberately (see below), not solved here.

## The trade-off, made explicit

Issuing credit before the book is physically back means: if a school never sends it, iPlus has
given away a replacement book and a spendable credit with nothing recovered. This is a deliberate
business decision (get correct books to schools fast > protect against the rare non-return), not
an oversight — flagged here so it's a visible, on-the-record trade-off, not a silent one.

## Mechanism

### Status model: three states instead of two

```
requested  →  credit_issued  →  received
```

`product_returns.status` CHECK constraint extends from `('requested', 'received')` to
`('requested', 'credit_issued', 'received')`. `condition_on_receipt` still only becomes non-null at
`received` — the existing `product_returns_condition_set_on_receipt` constraint's `requested` branch
now needs to also cover `credit_issued` (both pre-receipt states require `condition_on_receipt IS
NULL`).

### New RPC: `issue_credit_for_return(p_return_id uuid)`

- Gated `role IN ('superadmin', 'accountant')` — same as today's confirm step, this is where the
  money-authorization boundary already lives, unmoved.
- Advisory lock on the return id (same domain/pattern already established for this feature).
- Requires `status = 'requested'` — else a clear error ("already issued" / "already received").
- Everything currently in `confirm_return_received`'s credit-minting half moves here unchanged:
  read `unit_price`/`quantity` from the invoiced line item, compute `credit_amount = unit_price *
  quantity`, atomic per-FY counter, insert the `credit_notes` row.
- Sets `product_returns.status = 'credit_issued'` — no stock touched, no `condition_on_receipt` set.

### `confirm_return_received` → renamed `mark_return_received(p_return_id uuid, p_condition text)`

Behavior fundamentally changes (no longer mints anything), so this is a rename, not an in-place
edit — the old name is actively misleading once it stops "confirming" a receipt-and-credit event
and only does the stock half. Requires an explicit `DROP FUNCTION` for the old name (a same-named
`CREATE OR REPLACE` wouldn't apply here since the name itself changes) plus re-granting exactly
what `report_return`/other Sales RPCs already have (`authenticated`, `service_role`; never `anon`)
— same discipline the wrong-item-shipped plan's `DROP FUNCTION` fix already established this week.

- Same role gate, same advisory lock.
- Requires `status = 'credit_issued'` (not `requested`) — enforces the new order at the DB level,
  not just in the UI.
- Stock routing: identical to what's already live — `COALESCE(actual_product_id, invoiced
  product_id)`, resellable restocks it, damaged doesn't, NULL-product guard unchanged.
- Sets `status = 'received'`, `condition_on_receipt`, `received_by`, `received_at`.
- Does **not** touch `credit_notes` at all — that already happened.
- `RETURNS void` (nothing new is minted to return an id for).

## UI

- **`ReturnsPage.tsx`** — three tabs instead of two: **Requested** (status=requested, action: "Issue
  Credit"), **Awaiting Return** (status=credit_issued, action: "Mark Received"), **Received**
  (status=received, unchanged, terminal).
- **New `IssueCreditDialog.tsx`** — opened from the Requested tab (superadmin/accountant only,
  same visibility rule as the existing confirm button). Shows school, item, quantity, and the
  computed credit amount (`unit_price * quantity`, read from the same `invoice_line_items` join
  the page already has — just needs `unit_price` added to the existing select) before confirming,
  matching this codebase's established pattern of showing the exact number before a money action
  fires (e.g. the bold payment-deletion confirmation built earlier this week). Calls
  `issue_credit_for_return`.
- **`ConfirmReturnReceiptDialog.tsx` → renamed `MarkReturnReceivedDialog.tsx`** — same UI (condition
  radio, unchanged), calls `mark_return_received` instead. Success copy changes from "Return
  received, credit note issued" to "Return received, stock updated" — accurate to what actually
  just happened, since the credit moved earlier.

## Error handling

- `issue_credit_for_return` on a return that's already `credit_issued` or `received` → specific
  error, not a bare constraint violation.
- `mark_return_received` on a return still `requested` (credit not yet issued) → specific error
  ("Issue credit before marking this received") rather than a confusing generic failure — this is
  the DB enforcing the mandatory order, and the error should say so plainly.

## Testing

No automated test suite (established convention). Verification: `tsc --noEmit` clean; live RPC
loop inside a rolled-back transaction — report a return → issue credit (assert `credit_notes` row
exists, status now `credit_issued`, no stock change yet) → mark received resellable (assert stock
corrects on the right product, status now `received`, no second credit note minted) → confirm
`mark_return_received` rejects a `requested`-status return with the specific ordering error.

## Out of scope (explicitly not building)

- A way to reverse/claw back an issued credit if the book never returns.
- Any change to who can report a return.
- Any alternate path that skips credit-first ordering.
