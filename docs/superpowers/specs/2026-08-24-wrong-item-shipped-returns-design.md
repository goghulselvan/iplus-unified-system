# Wrong-Item-Shipped Returns — Design

## Goal

`report_return`/`confirm_return_received` (built 2026-08-21) assume the product that comes back
is always the product that was invoiced. That's true for "damaged in transit" and "school never
wanted it" returns, but false for the case this was originally meant to cover too — a genuine
fulfillment mix-up where a *different* physical book was picked and shipped than what's on the
invoice. Today, confirming that kind of return as "resellable" restocks the wrong product (the one
correctly on the invoice, which never actually left) and does nothing for the product that
actually shipped out — a real gap, currently worked around manually via two Stock Movements
entries per incident.

This adds one optional field to Report Return — "what was actually sent instead" — and wires it
through so stock corrects itself on the right product, automatically, on both ends of the return.

## Scope

**In scope:** the `wrong_item_shipped` reason category only. When staff know (or later learn)
which product actually went out, they record it once; the system handles both stock corrections.

**Out of scope, deliberately:**
- The other three reason categories (`wrong_item_ordered_by_staff`, `damaged_in_transit`, `other`)
  — in all of them, what comes back genuinely is the invoiced product. No field, no behavior change.
- Editing or canceling a return once reported — already a known, separately-flagged gap in the
  base feature (no `cancel_return` RPC exists yet). Not solved here; same limitation carries over.
- A formal "which SKU actually shipped" audit anywhere outside `product_returns` itself (e.g. no
  change to `invoice_line_items`, which stays untouched exactly as the base feature already
  guarantees).

## Mechanism

### Schema: one nullable column

```sql
ALTER TABLE public.product_returns
  ADD COLUMN actual_product_id uuid REFERENCES public.products(id);
```

NULL means "what came back is what was invoiced" (today's only behavior, unchanged). Set means
"what came back is this product instead."

### `report_return` — new optional param, plus an immediate stock correction

New signature: `report_return(p_invoice_line_item_id uuid, p_quantity integer, p_reason_category
text, p_reason_note text, p_actual_product_id uuid DEFAULT NULL)`.

When `p_actual_product_id` is provided:
- Validate it's a real, active product (`SELECT 1 FROM products WHERE id = p_actual_product_id AND
  is_active = true`), else raise a clear error.
- Store it on the new `product_returns` row.
- **Immediately** decrement that product's stock by `p_quantity` — atomically (`UPDATE products SET
  stock_quantity = stock_quantity - p_quantity WHERE id = ... RETURNING stock_quantity`), same
  pattern as every other stock-touching RPC in this module. This doesn't wait for physical
  receipt, because it isn't correcting something that's about to happen — it's correcting the
  record for something that already happened (the wrong book already left the building at
  original dispatch; the system just never knew, because the invoice pointed at a different SKU).
  Matches this codebase's existing precedent (`create_invoice`) of letting stock go negative
  rather than blocking — the physical shortfall is real regardless of what the counter says.

When `p_actual_product_id` is NULL: identical to today, no stock effect at report time (matches
current behavior for the other three reason categories, and for `wrong_item_shipped` reports where
staff don't yet know the wrong SKU).

All existing guards (`is_crm_user()`, quantity > 0, valid reason category, school-billed/non-void
invoice check, advisory lock + over-return guard) are unchanged.

### `confirm_return_received` — restock whichever product actually needs it

Currently reads `product_id` from `invoice_line_items` and restocks that on `resellable`. New
logic: read `product_returns.actual_product_id` too; if set, restock *that* product instead of the
invoiced one. If not set, behavior is byte-identical to today.

```sql
SELECT product_id, unit_price, invoice_id INTO v_product_id, v_unit_price, v_invoice_id
FROM invoice_line_items WHERE id = v_line_item_id;

SELECT actual_product_id INTO v_actual_product_id FROM product_returns WHERE id = p_return_id;
v_restock_product_id := COALESCE(v_actual_product_id, v_product_id);

IF p_condition = 'resellable' THEN
  IF v_restock_product_id IS NULL THEN
    RAISE EXCEPTION 'This line has no catalog product — it cannot be restocked; record it as damaged instead';
  END IF;
  UPDATE products SET stock_quantity = stock_quantity + v_quantity WHERE id = v_restock_product_id;
END IF;
```

The credit-note amount calculation (`v_unit_price * v_quantity`, from the *invoiced* line item) is
**unchanged** — money always tracks what was billed, regardless of which physical SKU shipped.
This is the key invariant that makes the split safe: stock corrects on the real product, money
stays anchored to the invoice.

The existing NULL-product guard (added 2026-08-23 for custom/no-catalog invoice lines) still
applies to `v_product_id` — unaffected, since `v_restock_product_id` only falls back to it when
`actual_product_id` is NULL.

### Getting the correct item to the school — no new mechanism needed

The correct product's own stock was already decremented once, at original invoice-creation time
(`create_invoice`), on the assumption it had shipped. It hadn't — but once the real corrective
shipment goes out, that number becomes true retroactively, with no further stock action needed.
The only remaining step is marking the invoice **Dispatched**, which already exists
(`mark_invoice_dispatched`, purely a timestamp, no stock effect) — nothing new to build here.

## UI

- **`ReportReturnDialog.tsx`** — when `reason === 'wrong_item_shipped'`, show an additional field:
  a product picker labeled "What was actually sent instead? (optional)", sourced from `products`
  where `is_active = true`, ordered by name. Optional, not required — staff filing the report from
  a customer complaint may not yet know the wrong SKU; they can file the return now and this can be
  added by... actually it can't be edited after the fact (no edit path exists, see Out of Scope), so
  the dialog's helper text should say plainly: "Leave blank if you don't know yet — you can still
  report this return, but stock will only correct for the invoiced item unless you specify what was
  actually sent." Hidden entirely for the other three reason categories.
- **`ReportReturnDialog.tsx` → `report_return` call** — pass `p_actual_product_id` when set.
- **`ReturnsPage.tsx`** — the Item column shows the invoiced item name; when `actual_product_id` is
  set, add a second line underneath: "Shipped instead: {product name}" so whoever processes Confirm
  Receipt later (possibly a different staff member) knows what to expect physically before they
  pick a condition.

## Error handling

- Invalid/inactive `p_actual_product_id` → clear error naming the problem, not a bare FK violation.
- Everything else — the over-return guard, the advisory locks, the role gate on
  `confirm_return_received`, the void/prospect-invoice exclusions — is entirely unchanged from the
  base feature and isn't touched by this addition.

## Testing

No automated test suite in this codebase (established convention). Verification: `tsc --noEmit`
clean; direct RPC calls against the live linked database exercising the full loop (report a return
with `p_actual_product_id` set → confirm the actual product's stock dropped immediately → confirm
receipt as resellable → confirm the actual product's stock is restored, not the invoiced product's
→ confirm the credit note amount still matches the invoiced product's price); confirm the
`actual_product_id IS NULL` path is byte-for-byte unaffected (existing damaged-in-transit /
wrong-item-ordered-by-staff flows keep working exactly as before).

## Out of scope (explicitly not building)

- Editing/canceling a reported return.
- Extending `actual_product_id` to the other three reason categories.
- Any new UI on `ConfirmReturnReceiptDialog.tsx` itself — the RPC already routes to the correct
  product internally; the confirming staff member doesn't need to make an extra choice there.
