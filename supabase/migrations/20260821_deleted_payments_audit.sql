-- Dedicated, tamper-resistant audit trail for deleted payments — money records
-- are sensitive, and an app-level "insert a log row before deleting" (what
-- delete_pending_payment_submission did until now) only fires when someone goes
-- through that RPC. A delete made directly via the Supabase dashboard/Table
-- Editor bypasses it entirely and is currently invisible with no way to
-- reconstruct it after the fact (found and left unresolved earlier today while
-- investigating a separate report). Fixed properly: a real Postgres AFTER
-- DELETE trigger on both payment tables, which fires no matter how the row was
-- deleted — through the app, a raw client call, or the dashboard directly.
CREATE TABLE IF NOT EXISTS public.deleted_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL CHECK (source_table IN ('portal_payment_submissions', 'payment_transactions')),
  original_id uuid NOT NULL,
  school_id uuid NOT NULL REFERENCES public.schools(id),
  amount numeric NOT NULL,
  payment_mode text,
  payment_date date,
  reference text,
  screenshot_url text,
  notes text,
  -- Who the app-level session was at delete time — null for a delete made
  -- outside any authenticated request (e.g. the SQL editor via service role),
  -- since auth.uid() has nothing to resolve there. A null here IS the signal
  -- that a delete bypassed the normal app flow, not a bug to fix.
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deleted_payments_school_id ON public.deleted_payments(school_id);

ALTER TABLE public.deleted_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deleted_payments_select_staff" ON public.deleted_payments;
CREATE POLICY "deleted_payments_select_staff" ON public.deleted_payments FOR SELECT USING (is_crm_user());
-- No write policy at all — this table is only ever written by the triggers
-- below, which run as SECURITY DEFINER regardless of the deleting session's
-- own grants. Nobody, including staff, can insert/edit/delete a row here directly.

CREATE OR REPLACE FUNCTION public.trg_fn_capture_deleted_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'portal_payment_submissions' THEN
    INSERT INTO deleted_payments (source_table, original_id, school_id, amount, payment_mode, payment_date, reference, screenshot_url, notes, deleted_by)
    VALUES ('portal_payment_submissions', OLD.id, OLD.school_id, OLD.amount_paid, OLD.payment_mode, OLD.payment_date, OLD.utr_reference, OLD.screenshot_url, OLD.notes, auth.uid());
  ELSIF TG_TABLE_NAME = 'payment_transactions' THEN
    INSERT INTO deleted_payments (source_table, original_id, school_id, amount, payment_mode, payment_date, reference, notes, deleted_by)
    VALUES ('payment_transactions', OLD.id, OLD.school_id, OLD.payment_amount, OLD.payment_mode, OLD.payment_date, OLD.transaction_reference, OLD.notes, auth.uid());
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_deleted_payment ON public.portal_payment_submissions;
CREATE TRIGGER trg_capture_deleted_payment
  AFTER DELETE ON public.portal_payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_capture_deleted_payment();

DROP TRIGGER IF EXISTS trg_capture_deleted_payment ON public.payment_transactions;
CREATE TRIGGER trg_capture_deleted_payment
  AFTER DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_capture_deleted_payment();

-- delete_pending_payment_submission no longer needs its own manual insert into
-- an audit table — the trigger above now captures every delete unconditionally,
-- including this RPC's own DELETE statement. Keeps the existing
-- security_audit_logs entry too (the CRM's general-purpose audit log, used
-- everywhere else) — deleted_payments is additional, not a replacement.
CREATE OR REPLACE FUNCTION public.delete_pending_payment_submission(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub portal_payment_submissions%ROWTYPE;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only iPlus superadmins can delete a payment submission';
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_sub.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending (not yet acknowledged) submissions can be deleted this way — an acknowledged one already affected the school''s payment total and needs a proper reversal instead';
  END IF;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    auth.uid(), 'PORTAL_PAYMENT_SUBMISSION_DELETED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'amount_paid', v_sub.amount_paid,
      'payment_mode', v_sub.payment_mode, 'payment_date', v_sub.payment_date,
      'screenshot_url', v_sub.screenshot_url
    )
  );

  DELETE FROM portal_payment_submissions WHERE id = p_submission_id;
END;
$function$;
