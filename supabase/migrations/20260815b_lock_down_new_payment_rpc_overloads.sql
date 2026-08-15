-- Follow-up to 20260815_payment_verification_amounts.sql: CREATE OR REPLACE FUNCTION with a
-- changed argument list creates a new Postgres function object (an overload), which does NOT
-- inherit the grants of the old signature it superseded. The old signatures of these two RPCs
-- were deliberately locked down (no anon/PUBLIC execute); the new signatures picked up
-- Postgres's default-open grants instead, widening network-reachable surface on financial RPCs.
-- Not currently exploitable (is_crm_user() still rejects anon/unauthenticated callers inside
-- the function body), but this restores the codebase-wide lockdown convention.

REVOKE EXECUTE ON FUNCTION public.acknowledge_portal_payment(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_portal_payment(uuid,uuid,numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_product_order_payment(uuid,numeric) TO authenticated, service_role;
