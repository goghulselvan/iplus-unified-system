-- payment_transactions has RLS enabled but somewhere along the way lost every
-- policy that used to be on it (the original 2025-09-23 migration created 3:
-- select/insert/update, all gated on is_accountant_or_above()). With RLS on
-- and zero policies, Postgres defaults to denying everything — every "Add
-- Payment" attempt, for every school, by every user, was silently failing
-- with 42501. Restoring the original intended policies verbatim.

CREATE POLICY "Accountants can view payment transactions"
ON public.payment_transactions
FOR SELECT
USING (is_accountant_or_above());

CREATE POLICY "Accountants can insert payment transactions"
ON public.payment_transactions
FOR INSERT
WITH CHECK (is_accountant_or_above() AND auth.uid() = created_by);

CREATE POLICY "Accountants can update payment transactions"
ON public.payment_transactions
FOR UPDATE
USING (is_accountant_or_above());
