# Book Sales Module (Products + Invoicing) — Design

**Date:** 2026-07-28
**Status:** Approved by Goghul (chat, 5 decisions answered)

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
   not just a PDF utility.
5. **Access: all CRM roles** (superadmin/manager/accountant) — matches how every other module
   in this CRM works today (role toggles exist in `module_permissions`/Users.tsx but aren't
   enforced anywhere in code; not the place to introduce the first enforcement).
6. **Insufficient stock: warn, don't block.** Creating an invoice for more units than are in
   stock shows a toast warning but still proceeds — book orders can reasonably exceed what's
   currently logged (e.g. stock count not yet updated after a delivery).

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
- `status text NOT NULL DEFAULT 'unpaid'` (`unpaid` | `paid`), `paid_at timestamptz NULL`
- `created_by uuid`, `created_at timestamptz DEFAULT now()`
- RLS: `is_crm_user()` for SELECT/INSERT/UPDATE. No DELETE policy (matches `call_followups`'
  reasoning — a real ledger shouldn't allow deleting rows).
- **Invoices are immutable except the paid/unpaid toggle** — UPDATE is scoped in the UI to
  flipping `status`/`paid_at` only; there is no line-item/amount editing and no void/cancel
  flow in this build. If an invoice is created with a mistake, the fix is issuing a fresh
  corrected invoice, not editing the original — same finality real invoices have.

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

### RPC `create_invoice(p_school_id, p_prospect_school_id, p_buyer_name, p_buyer_address, p_buyer_state, p_buyer_gstin, p_line_items jsonb)`
- SECURITY DEFINER, one-time `is_crm_user()` guard (per prospect-search-perf lesson).
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
  same badge style as Call Center's Link dialog) / Grand Total / Status (Paid/Unpaid badge) /
  Download PDF button / "Mark as Paid" action (updates `status`+`paid_at`, no separate payment
  ledger — a simple boolean, not multi-installment tracking like registration payments have).
- "+ New Invoice" opens `src/pages/BookSales/NewInvoiceDialog.tsx`:
  1. School search box (name or SS No) hitting `search_schools_for_invoice` — CRM and Prospect
     results badge-differentiated, same pattern as Call Center's Link dialog.
  2. Selecting a result prefills Buyer Name/Address/State (editable); GSTIN field starts blank
     (optional, freetext).
  3. Line items table: S.No (auto) / Item (dropdown from active Products, or free-text for a
     one-off item not in the catalog) / Price (auto-filled from product, editable) / Qty /
     Total (computed) — "+ Add Row" / remove-row per row.
  4. Live-computed footer: Subtotal, then CGST+SGST (if buyer state = Tamil Nadu) or IGST
     (otherwise), then Grand Total — recomputed on every line/qty/price change.
  5. "Generate Invoice" → calls `create_invoice`, then generates the PDF client-side and
     triggers a download (same blob-URL pattern as `EnhancedPaymentTracker.tsx`'s
     `handleDownloadReceipt`), shows any low-stock toast warnings returned by the RPC.

### `src/utils/invoiceGenerator.ts` (new, mirrors `receiptGenerator.ts`)
- Same visual language: pdf-lib, same fonts/colors/watermark/logo, so it reads as a sibling of
  the payment receipt.
- Header: logo, "TAX INVOICE" + seller GSTIN (`33AAFCI1730F1Z3`) top-right.
- Seller block (centered, same position as receipt's company block): **"iPlus Olympiads"**
  (bold) / "by Ivar Pro Learn for Universal Success Pvt. Ltd." / "115, GST Road, Guduvancheri,
  Chennai 603 202" / "+91 81110 66556".
- Meta row: Invoice No. / Date / Status.
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
- No multi-installment payment tracking on invoices (decision #4's "Mark as Paid" is a single
  boolean flip, not a `payment_transactions`-style ledger).
- No PDF emailing/WhatsApp-ing of invoices from this build — download only, matching exactly
  what was asked ("can download the invoice as pdf like we have receipt").
