-- The old, pre-verified-amount signatures of these two RPCs (see
-- 20260815_payment_verification_amounts.sql) were deliberately kept alongside
-- the new ones during the backend-ahead-of-frontend rollout window, so the
-- then-still-live old frontend (calling the old signatures) wouldn't break.
-- Tasks 2/3 have now shipped the frontend that calls the new signatures —
-- dropping the old, now-uncalled overloads.
DROP FUNCTION IF EXISTS public.acknowledge_portal_payment(uuid, uuid);
DROP FUNCTION IF EXISTS public.confirm_product_order_payment(uuid);
