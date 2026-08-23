-- supabase/migrations/20260823_accounts_payments_in_view.sql
--
-- Normalizes every money-IN transaction (registration fee payments + confirmed
-- book-order payments) into one shape for the Accounts module's Payments page.
-- security_invoker = true is mandatory (a prior feature in this codebase shipped
-- a summary view without it and it silently bypassed RLS) — this means the view
-- runs under the querying user's own rights on payment_transactions/
-- product_orders/schools, so it cannot be more restrictive than those tables
-- already are (they're already accountant-or-above / staff-wide). The
-- accountant+superadmin-only boundary for this module is enforced at the route
-- level (ProtectedRoute accountantOnly), not here — see the spec for why a
-- view-level role policy would be non-functional (views don't carry policies;
-- only tables do).
--
-- Dedup: a portal-submitted registration payment only reaches payment_transactions
-- once staff acknowledges it (acknowledge_portal_payment() inserts the row itself
-- at acknowledgment time) — reading only payment_transactions here cannot
-- double-count against portal_payment_submissions. Book-order payments have no
-- separate installment table — one product_orders row is one payment event, so
-- filtering to payment_status = 'confirmed' is the complete set.
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
