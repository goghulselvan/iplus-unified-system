-- Security fix: inventory_supplier_payment_totals bypassed RLS (ran with owner
-- privileges instead of the querying user's), exposing supplier payment totals
-- to unauthenticated (anon) requests. Same class of bug already fixed once in
-- this codebase for accountant_payment_view — same remedy applied here.
CREATE OR REPLACE VIEW public.inventory_supplier_payment_totals
WITH (security_invoker = on) AS
SELECT supplier_id, SUM(amount) AS total_paid
FROM public.inventory_supplier_payments
GROUP BY supplier_id;
