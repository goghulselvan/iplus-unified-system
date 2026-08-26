-- accounts_payments_in's book_order branch showed the raw product_orders.payment_mode
-- (whatever staff last had selected in the dropdown) even when the order was actually
-- paid via an applied credit note — e.g. Infant Jesus N & P School's ₹0 book order
-- showed "NEFT" even though ₹0 moved through any bank channel; the whole amount was
-- covered by a credit note from an earlier return. Only create_manual_product_order
-- sets applied_credit_note_id (portal-submitted orders never do), and manual orders
-- land straight in payment_status='confirmed' at creation, so applied_credit_note_id
-- being non-null on a row already in this view reliably means credit was used.
CREATE OR REPLACE VIEW public.accounts_payments_in
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
  CASE
    WHEN po.applied_credit_note_id IS NOT NULL AND po.payment_amount = 0
      THEN 'Credit Note'
    WHEN po.applied_credit_note_id IS NOT NULL AND po.payment_amount > 0
      THEN 'Credit Note + ' || po.payment_mode
    ELSE po.payment_mode
  END AS payment_mode,
  po.payment_utr_reference AS reference,
  po.created_by,
  po.created_at
FROM product_orders po
JOIN schools s ON s.id = po.school_id
WHERE po.payment_status = 'confirmed';
