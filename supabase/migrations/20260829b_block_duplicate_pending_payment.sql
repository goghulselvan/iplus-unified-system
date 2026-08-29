-- A-1 Nursery and Primary School (SS 11394) submitted a ₹5,550 payment proof,
-- then submitted the SAME amount again 27 minutes later (still pending review
-- both times) — the portal's hasPending flag only shows an informational
-- banner, the submit form stays fully open regardless. Enforcing this only in
-- the frontend wouldn't actually stop it (RLS lets a school insert directly
-- into portal_payment_submissions), so this is a DB-level guard.
--
-- Deliberately scoped to "same amount, still pending" rather than "any second
-- submission" — a school legitimately paying in installments (no new
-- students required) still needs to be able to submit a second, different
-- amount while the first is awaiting review.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_pending_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only guards the school's own self-service submission. Staff inserting
  -- directly (superadmin/CRM tooling) bypasses this, same as every other
  -- staff-can-override pattern in this schema.
  IF is_crm_user() THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM portal_payment_submissions
    WHERE school_id = NEW.school_id
      AND project_id = NEW.project_id
      AND status = 'pending'
      AND amount_paid = NEW.amount_paid
  ) THEN
    RAISE EXCEPTION 'duplicate_pending_payment: A payment of this amount is already submitted and awaiting review';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_pending_payment ON public.portal_payment_submissions;
CREATE TRIGGER trg_prevent_duplicate_pending_payment
  BEFORE INSERT ON public.portal_payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_pending_payment();
