# Payment Verification / Declared-vs-Proof Mismatch — Design

## Goal

A school (or staff, for manual book orders) declares an amount paid and uploads a screenshot as proof — in both the registration payment flow (`portal_payment_submissions`) and the book order flow (`product_orders`). Today, nothing checks that the declared number actually matches what the screenshot shows; staff eyeball the two side by side, and the declared figure is trusted as-is everywhere downstream (running totals, "Partial"/"Paid in full" status, notifications).

Real scenario this needs to handle: a school owes ₹9,000, sends a first transfer of only ₹7,000 but declares ₹9,000, then sends a second transfer of ₹2,000 to make up the difference (or to correct the shortfall once noticed). Nothing today distinguishes "the declared number is wrong" from "the declared number is right" — the wrong number just flows straight into whatever total the system tracks.

This spec covers both flows with one shared mechanism, applied differently to each given their different current shapes (registration already supports multiple accumulating submissions; book orders are single-payment and stay that way).

## Core mechanism: verified amount

Every payment review action (registration acknowledge, book-order confirm) gains a **`verified_amount`** input, defaulting to the declared amount, editable by the staff member reviewing. Staff types what they actually see in the screenshot. If left untouched it equals the declared amount — zero extra friction on the common case.

From the moment of review onward, **`verified_amount` is the number of record** — it's what feeds any running total, any paid/partial/overpaid determination, any downstream notification. The originally-declared amount is kept as-is for audit purposes but never used in a calculation again once a `verified_amount` exists.

A mismatch is a plain inequality: `verified_amount IS DISTINCT FROM declared_amount`. No tolerance/rounding band — exact. Where a mismatch exists, the reviewed record shows a small "⚠ Corrected from ₹X → ₹Y" badge wherever that record is later displayed (queue history, school detail), so it's auditable after the fact without needing a separate audit table.

## Registration payments (`portal_payment_submissions`)

This flow already supports multiple submissions accumulating toward an expected total (`acknowledge_portal_payment` computes `total_paid` vs `expected`, returning `payment_status` of `Received`/`Partial`). The only change is *which number* feeds that sum.

**Schema:**
- `portal_payment_submissions` gains `verified_amount numeric` (nullable — null until acknowledged).

**RPC — `acknowledge_portal_payment`:**
- New required param `p_verified_amount numeric`.
- Stores it on the submission row.
- `total_paid` is now `SUM(verified_amount)` across all `acknowledged` submissions for that school+project — **not** `SUM(amount_paid)`. Everything else about the function (return shape, `Received`/`Partial` derivation against `expected`) is unchanged.

**UI — `PaymentQueue.tsx`:**
- The Acknowledge action gains a "Verified Amount" field, pre-filled with `amount_paid`, editable before confirming.
- If the staff member changes it away from the declared amount, show an inline confirmation before submitting ("Recording ₹7,000 — school declared ₹9,000. Continue?") — a soft check, not a hard block; staff can always override.
- Mismatch badge shown in the "All" filter view next to any acknowledged submission where the two figures differ.

**Notifications:** no new work needed. The existing `payment_partial` WhatsApp/email template already fires automatically whenever `acknowledge_portal_payment` returns `payment_status: 'Partial'` (see `PaymentQueue.tsx`'s `onSuccess`). Once `total_paid` is computed from verified amounts, a school that's actually short — even if their own declared number said otherwise — correctly receives the existing "partial, please pay the balance" message. This is the main practical payoff of the fix: the school finds out about their own shortfall automatically, without staff having to notice and chase it manually.

## Book order payments (`product_orders`)

Deliberately **stays single-payment** — no ledger of multiple submissions like registration has. The gap this needs to close is narrower: right now, if a school's (or staff-entered) declared amount is short, the only tool is "Request Resubmit," which discards the existing proof entirely and asks for a whole new submission. Given most live orders are staff-entered from a phone call (`source = 'manual'`), that's heavier than needed for "the school sent a second transfer, here's the rest."

**Schema:**
- `product_orders` gains `verified_amount numeric` (nullable — null until confirmed).
- No new table for multi-proof history. Trade-off, accepted deliberately: only the *latest* declared amount/screenshot are kept, not a full transfer-by-transfer history. `payment_review_note` (already exists on the table) is the place staff leave a short note when they update the record — e.g. "First proof ₹7,000, second transfer ₹2,000 confirmed via WhatsApp 15 Aug" — giving a lightweight paper trail without new schema.

**New action — "Update Payment" (`OrderRequestDetail.tsx`):**
- Visible only while `payment_status = 'pending'` (i.e. not yet confirmed or resubmit-requested).
- Lets staff edit `payment_amount`, `payment_mode`, `payment_date`, `payment_utr_reference`, `payment_account_holder_name`, and re-upload `payment_screenshot_url` **in place**, any number of times, without triggering a resubmit/reject cycle.
- New RPC: **`update_order_payment_details(p_order_id, p_payment_amount, p_payment_mode, p_payment_date, p_payment_utr_reference, p_payment_account_holder_name, p_payment_screenshot_url, p_note)`** — staff-side, `is_crm_user()`. Only allowed when `payment_status = 'pending'`. Overwrites the payment fields, appends `p_note` to `payment_review_note` (timestamped, not replaced).

**RPC — `confirm_product_order_payment`:**
- New required param `p_verified_amount numeric`. Stores it on the order.
- Behaviour otherwise unchanged (still sets `payment_status='confirmed'`, `confirmed_at=now()`).

**`request_order_payment_resubmit` is unchanged** and still available — it remains the tool for a hard rejection (unclear/fraudulent screenshot, wrong school, etc.), a different case from "more proof is trickling in for a real order."

**UI — `OrderRequestDetail.tsx`:**
- The Confirm Order action gains the same "Verified Amount" field + soft mismatch confirmation as the registration flow.
- Mismatch badge shown next to `payment_amount` on the confirmed order (School Detail's Book Orders tab and the Order Requests list) whenever `verified_amount` differs from the last declared `payment_amount`.

**Notifications:** none added. Resolution here is expected to happen the way it already does for this mostly-manual flow — staff already has direct phone/WhatsApp contact with these schools.

## Out of scope (explicitly not building)

- OCR/automated screenshot amount extraction — considered and rejected in favor of the staff-verified-amount approach; a real technical lift (vision API, wide variance in UPI/bank screenshot formats) for a flow that's manually reviewed either way.
- A full multi-proof ledger for book orders — registration already has this; book orders deliberately stay single-payment with in-place editing instead.
- Tolerance/rounding band on the mismatch check — exact inequality only.
