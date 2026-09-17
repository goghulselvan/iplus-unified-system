-- credit_notes_with_balance ran as its owner, so it skipped credit_notes' RLS
-- (is_crm_user()) and anyone holding the public anon key could read every
-- credit note — amounts, bank references and 2-year signed payment-proof URLs.
-- Run it as the caller instead; staff keep access through the table policy.
ALTER VIEW public.credit_notes_with_balance SET (security_invoker = true);
