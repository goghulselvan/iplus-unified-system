# Book Sales Module (Products + Invoicing) — Design

**Date:** 2026-07-28
**Status:** Approved by Goghul (chat, 5 decisions answered; revised same day with role-based
permissions, payment method, and invoice list search/filter/sort)

## Problem

Goghul wants to bill schools (CRM + Prospect) for book/material purchases, separate from
olympiad registration payments. No products catalog, no invoicing, no GST handling exists
today. Needs a third top-level module (alongside Prospect Schools and CRM) with a Products
catalog and a persistent, numbered invoice ledger — modeled after the existing payment-receipt
feature (`receiptGenerator.ts`, per-FY auto-numbering) so it looks and behaves like a sibling
of something already proven in this CRM.

## Decisions (final — do not re-ask)

1. **Third `ModuleSelect.tsx` tile — "Book Sales"** → `/booksales`. Own layout
   (`BookSalesLayout.tsx`, mirrors `ProspectLayout.tsx`), two nav items: **Products**,
   **Invoices**. No dedicated Stock page — stock is a column on the Products page, edited via
   the same "Edit Product" dialog as everything else (Goghul confirmed: Products page is enough).
2. **GST type auto-detected by buyer's state**, not a fixed choice: buyer state = Tamil Nadu →
   CGST+SGST split; any other state → IGST. Same total rate either way, just split differently.
   This matters because prospect/CRM schools span 6 states (TN/KA/TG/AP/KL/PY) while the seller
   (Ivar Pro Learn) is TN-GST-registered — a sale to a non-TN school legally requires IGST.
3. **Products = rate card + stock tracking** (not a bare price list): name, HSN/SAC code, GST
   rate, unit price, stock quantity. Low-stock badge at a fixed threshold (<5 units, not
   per-product configurable — YAGNI unless it proves necessary).
4. **Invoices are a persistent ledger**, not a one-off generate-and-download tool: every
   invoice gets a permanent auto-number (same per-FY pattern as receipts), is saved to the DB,
   and shows up in a searchable history per school. This is the actual book-sales sales record,
   not just a PDF utility. Superadmin/Accountant can also **edit** an existing invoice's buyer
   details and line items after creation (see decision #9) — this is not the immutable-ledger
   model an earlier draft of this spec assumed; revised per Goghul's explicit ask.
5. **Role-based access on Invoices — the first enforced-in-code role restriction in this CRM.**
   Superadmin and Accountant: create, edit, delete, void. Manager: **create only** — cannot
   edit, delete, void, or even mark an existing invoice paid once it exists. Enforced via RLS +
   an explicit role check inside the write RPCs (RPCs are SECURITY DEFINER and bypass table RLS
   entirely, so the check has to live in the function body too, not just the policy).
   **Working assumption: this restriction applies to Invoices only.** Products (the catalog)
   stays open to all CRM roles for full CRUD, same as decision #3 always intended — it's
   master data, not a financial transaction record, and a manager reasonably needs to add a
   new book or adjust a price/stock count. Flag if you want Products locked down the same way.
6. **Insufficient stock: warn, don't block.** Creating or editing an invoice for more units
   than are in stock shows a toast warning but still proceeds. Editing an invoice's quantities
   adjusts stock by the **delta** between old and new quantity, not a blind re-decrement.
7. **Payment Method is a required field on every invoice**: a dropdown with exactly three
   options — **Cash Deposit**, **UPI**, **Online Transfer**. Deliberately narrower than (and
   separate from) registration payments' 6-option `payment_mode` list (Cash/Cheque/Online
   Transfer/UPI/Credit Card/Debit Card) — book-sales payments only come in these three forms.
8. **Void ≠ Delete — different actions for GST-audit reasons.** *Void* sets `status='void'`
   with a required `void_reason`, keeps the row and its invoice number visible in the list
   (excluded from any future sales-total reporting) — the invoice number sequence stays
   gap-free and explainable in an audit. *Delete* hard-removes the row and its line items
   entirely, which **does** leave a gap in the number sequence — reserved for genuine mistakes
   (wrong school picked, caught same day), not routine cancellation.
9. **Edit** re-opens the same line-item editor used to create the invoice, prefilled with the
   existing buyer details and line items. Saving recomputes GST/totals and adjusts stock by the
   quantity delta. `invoice_number`/`fy` never change once assigned, no matter how many times an
   invoice is edited.

## Data model (new migration)

### `products`
- `id uuid PK`, `name text NOT NULL`, `hsn_code text`, `gst_rate numeric NOT NULL` (0/5/12/18/28
  — 0% included because printed books, HSN 4901, are GST-exempt under Indian law; if the
  catalog is mostly books, most products will likely use the 0% rate),
  `unit_price numeric NOT NULL`, `stock_quantity integer NOT NULL DEFAULT 0`,
  `is_active boolean DEFAULT true`, `created_at`, `updated_at`
- RLS: `is_crm_user()` for SELECT/INSERT/UPDATE/DELETE (matches every other CRM-only table).

### `invoices`
- `id uuid PK`, `invoice_number integer`, `fy smallint` (assigned by trigger, same pattern as
  `receipt_fy_counters`/`generate_receipt_number()`)
- `school_id uuid NULL`, `prospect_school_id uuid NULL` — exactly one set (CHECK constraint),
  same dual-reference pattern already used by `bonvoice_call_logs`/`campaign_schools`
- Buyer fields **snapshotted at creation time** (so a later edit to the school's own address
  doesn't silently rewrite a past invoice): `buyer_name text NOT NULL`, `buyer_address text`,
  `buyer_state text NOT NULL`, `buyer_gstin text NULL` (most schools won't have one — optional
  freetext, not validated)
- `subtotal numeric NOT NULL`, `cgst_amount numeric DEFAULT 0`, `sgst_amount numeric DEFAULT 0`,
  `igst_amount numeric DEFAULT 0`, `grand_total numeric NOT NULL`
- `payment_method text NOT NULL` (`Cash Deposit` | `UPI` | `Online Transfer`)
- `status text NOT NULL DEFAULT 'unpaid'` (`unpaid` | `paid` | `void`), `paid_at timestamptz NULL`
- `void_reason text NULL`, `voided_by uuid NULL`, `voided_at timestamptz NULL`
- `created_by uuid`, `created_at timestamptz DEFAULT now()`
- RLS: SELECT/INSERT via `is_crm_user()` (any of the 3 roles can view and create). UPDATE and
  DELETE additionally require `EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND
  role IN ('superadmin','accountant'))` — a manager's direct table write attempt is rejected by
  Postgres itself, not just hidden in the UI.
- Editing/voiding go through RPCs (`update_invoice`, `void_invoice` — SECURITY DEFINER, so they
  **bypass table RLS entirely**); each RPC repeats the same role check explicitly in its own
  body before writing anything, so the restriction holds regardless of which path is used.
  Delete does not need an RPC (no computed fields, no multi-table transaction beyond the
  existing `ON DELETE CASCADE` to `invoice_line_items`) — the client calls
  `.from('invoices').delete()` directly and table RLS is sufficient.

### `invoice_line_items`
- `id uuid PK`, `invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE`
- `product_id uuid NULL REFERENCES products(id)` (soft reference only — kept for traceability,
  not relied on for display)
- `item_name text NOT NULL`, `hsn_code text`, `gst_rate numeric NOT NULL`,
  `quantity integer NOT NULL`, `unit_price numeric NOT NULL`, `line_total numeric NOT NULL`
  (all snapshotted, same reasoning as invoices' buyer fields — a later product price change
  must never alter a past invoice)
- `row_order integer NOT NULL` (preserves S.No display order)

### `invoice_fy_counters`
- Identical shape/purpose to `receipt_fy_counters`: `fy smallint PRIMARY KEY`,
  `last_no integer NOT NULL DEFAULT 0`

### RPC `create_invoice(p_school_id, p_prospect_school_id, p_buyer_name, p_buyer_address, p_buyer_state, p_buyer_gstin, p_payment_method, p_line_items jsonb)`
- SECURITY DEFINER, one-time `is_crm_user()` guard (per prospect-search-perf lesson) — any of
  the 3 roles may call this (create is unrestricted, per decision #5).
- Computes each line's `line_total` and per-line GST amount from its own `gst_rate` (so a cart
  mixing 5%/12%/18% products is handled correctly), sums into one CGST+SGST total (buyer_state
  = 'Tamil Nadu') or one IGST total (otherwise) — not a per-rate-slab breakdown table, matching
  the simple summary Goghul described.
- Assigns `invoice_number`/`fy` via the same atomic upsert-counter approach as
  `generate_receipt_number()`.
- Decrements `products.stock_quantity` per line (where `product_id` is set); if resulting stock
  would go negative, still allows it (warn-not-block, per decision #6) but returns a
  `low_stock_warnings` array in the response so the UI can toast it.
- Inserts `invoices` + `invoice_line_items` atomically (single function, single transaction).
- Returns the new invoice's id + invoice_number + fy so the client can immediately generate the
  PDF and download it.

### RPC `update_invoice(p_invoice_id, p_buyer_name, p_buyer_address, p_buyer_state, p_buyer_gstin, p_payment_method, p_line_items jsonb)`
- SECURITY DEFINER. **Explicitly checks `profiles.role IN ('superadmin','accountant')` first**
  and raises an exception otherwise — this check cannot be skipped by relying on table RLS,
  since SECURITY DEFINER functions run with the function owner's privileges, not the caller's.
- Does NOT touch `invoice_number`/`fy` (decision #9). Deletes and re-inserts
  `invoice_line_items` for this invoice, recomputes subtotal/GST/grand_total the same way
  `create_invoice` does, and adjusts `products.stock_quantity` by the **delta** between each
  line's old and new quantity (not a blind re-decrement, per decision #6) — this needs the old
  line items read before they're replaced.
- Refuses to run (returns an error) if the invoice's current `status = 'void'` — a voided
  invoice can't be silently un-voided via edit; it must be explicitly restored first (out of
  scope for this build — voiding is a one-way action here, matching decision #8's audit intent).

### RPC `void_invoice(p_invoice_id, p_reason text)`
- SECURITY DEFINER, same explicit role check as `update_invoice`.
- Sets `status='void'`, `void_reason=p_reason` (required, non-empty), `voided_by=auth.uid()`,
  `voided_at=now()`. Does not touch line items, amounts, or the invoice number — the row stays
  fully visible in history, just excluded from sales totals (decision #8).

### RPC `search_schools_for_invoice(p_query text, p_limit int DEFAULT 6)`
- Same shape as today's `search_callers_by_name` (union of `schools` + `prospect_schools`,
  SECURITY DEFINER, matches name OR exact SS No) but additionally returns `address`, `state`,
  `district` — the fields needed to prefill the Bill To block. Kept as its own function rather
  than widening `search_callers_by_name`'s return shape and risking breaking Call Center's
  existing usage of it.

## UI

### `src/pages/BookSales/ProductsPage.tsx` — route `/booksales/products`
- Table: Name / HSN-SAC / GST Rate / Unit Price / Stock / Active — low-stock badge (red) when
  `stock_quantity < 5`.
- "Add Product" dialog: Name, HSN/SAC, GST rate (dropdown: 0/5/12/18/28%), Unit Price, Initial
  Stock Qty. Same dialog reused for editing (prefilled).

### `src/pages/BookSales/InvoicesPage.tsx` — route `/booksales/invoices`
- List: Invoice No. (`INV/{fy}-{fy+1}/{seq}`) / Date / School (name + CRM-or-Prospect badge,
  same badge style as Call Center's Link dialog) / Grand Total / Payment Method / Status
  (Paid/Unpaid/Void badge) / Download PDF button.
- **Search box**: matches invoice number, buyer name, or school name (client-side filter over
  the loaded page — this table won't approach `prospect_schools`-scale row counts, so no
  dedicated search RPC needed).
- **Filters**: Status (All/Unpaid/Paid/Void), date range (from/to).
- **Sort**: dropdown — Newest First (**default**), Oldest First, Amount High→Low, Amount
  Low→High. "Newest" = highest `fy` then highest `invoice_number` — the true chronological
  order, not `created_at` (which would be equivalent but the invoice number is the canonical
  ordering for a numbered ledger).
- **Row actions, gated by role** (buttons simply don't render for a manager — matched by the
  same RLS/RPC-level checks server-side, so this isn't just a UI nicety):
  - All roles: Download PDF.
  - Superadmin/Accountant only: Edit (reopens the invoice dialog prefilled), Void (small
    dialog prompting for a required reason, then calls `void_invoice`), Delete (confirm dialog
    warning it's permanent and will leave a number-sequence gap, then direct
    `.from('invoices').delete()`), Mark as Paid/Unpaid toggle.
- "+ New Invoice" (all roles) and "Edit" (superadmin/accountant) both open
  `src/pages/BookSales/InvoiceDialog.tsx` — one shared dialog, prefilled when editing:
  1. School search box (name or SS No) hitting `search_schools_for_invoice` — CRM and Prospect
     results badge-differentiated, same pattern as Call Center's Link dialog. Disabled/locked
     when editing (the buyer isn't reassignable after creation — only their snapshotted
     details can change, e.g. a corrected address).
  2. Selecting a result prefills Buyer Name/Address/State (editable); GSTIN field starts blank
     (optional, freetext).
  3. Payment Method dropdown (required): Cash Deposit / UPI / Online Transfer.
  4. Line items table: S.No (auto) / Item (dropdown from active Products, or free-text for a
     one-off item not in the catalog) / Price (auto-filled from product, editable) / Qty /
     Total (computed) — "+ Add Row" / remove-row per row.
  5. Live-computed footer: Subtotal, then CGST+SGST (if buyer state = Tamil Nadu) or IGST
     (otherwise), then Grand Total — recomputed on every line/qty/price/payment-method change.
  6. "Generate Invoice" (create mode) → calls `create_invoice`; "Save Changes" (edit mode) →
     calls `update_invoice`. Either way, generates the PDF client-side and triggers a download
     (same blob-URL pattern as `EnhancedPaymentTracker.tsx`'s `handleDownloadReceipt`), shows
     any low-stock toast warnings returned by the RPC.

### `src/utils/invoiceGenerator.ts` (new, mirrors `receiptGenerator.ts`)
- Same visual language: pdf-lib, same fonts/colors/watermark/logo, so it reads as a sibling of
  the payment receipt.
- Header: logo, "TAX INVOICE" + seller GSTIN (`33AAFCI1730F1Z3`) top-right.
- Seller block (centered, same position as receipt's company block): **"iPlus Olympiads"**
  (bold) / "by Ivar Pro Learn for Universal Success Pvt. Ltd." / "115, GST Road, Guduvancheri,
  Chennai 603 202" / "+91 81110 66556".
- Meta row: Invoice No. / Date / Payment Method / Status.
- Bill To block: buyer name, SS No, address, state, GSTIN (if provided).
- Line items table: S.No / Item Name / HSN-SAC / Qty / Unit Price / Total — as many rows as
  were added.
- Tax summary: Subtotal, CGST (rate%) + SGST (rate%) **or** IGST (rate%), Grand Total.
- Footer (verbatim, matching the receipt's existing wording style): *"Computer-generated
  invoice — no signature required."* and *"Thank you for your purchase with iPlus Olympiads!"*

### Module registration
- New tile in `src/pages/ModuleSelect.tsx` (third grid item, own gradient color).
- New routes in `src/App.tsx`: `/booksales/products`, `/booksales/invoices`, each wrapped in
  `<ProtectedRoute>` same as every other module route.
- `BookSalesLayout.tsx` — top nav with Products/Invoices links, mirrors `ProspectLayout.tsx`.

## Out of scope (explicitly, per YAGNI)

- No dedicated Stock page (decision #1).
- No per-product configurable low-stock threshold (decision #3) — fixed at <5.
- No multi-installment payment tracking on invoices ("Mark as Paid" is a single boolean flip,
  not a `payment_transactions`-style ledger).
- No PDF emailing/WhatsApp-ing of invoices from this build — download only, matching exactly
  what was asked ("can download the invoice as pdf like we have receipt").
- No "un-void" / restore flow (decision #8/#9) — voiding is one-way in this build.
- No role restriction on Products (working assumption in decision #5 — flag if wrong).
- No per-line GST-rate breakdown table on the PDF (decision from the original design) — mixed-
  rate carts still just show one combined CGST+SGST-or-IGST total, not a slab-by-slab summary.
