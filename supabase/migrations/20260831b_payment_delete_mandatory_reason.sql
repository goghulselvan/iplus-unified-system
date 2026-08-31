-- ============================================================================
-- Payment delete: mandatory reason + real audit  — 2026-08-31
--
-- Two payment-delete paths, neither captured *why*:
--   1. Payment Queue -> delete_pending_payment_submission(uuid) : had a confirm
--      dialog + audit log, but no reason.
--   2. School Detail > Payment tab -> raw supabase.from('payment_transactions')
--      .delete() : NO RPC, and since payment_transactions has RLS enabled with no
--      DELETE policy, that client delete was in fact a SILENT NO-OP for staff —
--      only a Supabase-dashboard delete (postgres role) actually removed a row,
--      invisibly. This is the shape of the unexplained "little star" deletion.
--
-- This migration:
--   * deleted_payments.deletion_reason  — new column.
--   * trg_fn_capture_deleted_payment    — records the reason (a txn-local GUC the
--     RPCs set), so even a future direct/dashboard delete leaves a slot for it.
--   * delete_pending_payment_submission — now (uuid, text); reason >= 3 chars
--     required; 1-arg version DROPPED so the guard can't be bypassed.
--   * delete_payment_transaction(uuid, text) — NEW. Superadmin-only, reason
--     required, full old-row snapshot into security_audit_logs, then DELETE
--     (trg_sync_payment_status recomputes the school's totals automatically).
--     The frontend switches its raw .delete() to this.
-- ============================================================================

BEGIN;

ALTER TABLE public.deleted_payments ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE OR REPLACE FUNCTION public.trg_fn_capture_deleted_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(current_setting('app.delete_reason', true)), '');
BEGIN
  IF TG_TABLE_NAME = 'portal_payment_submissions' THEN
    INSERT INTO deleted_payments (source_table, original_id, school_id, amount, payment_mode, payment_date, reference, screenshot_url, notes, deleted_by, deletion_reason)
    VALUES ('portal_payment_submissions', OLD.id, OLD.school_id, OLD.amount_paid, OLD.payment_mode, OLD.payment_date, OLD.utr_reference, OLD.screenshot_url, OLD.notes, auth.uid(), v_reason);
  ELSIF TG_TABLE_NAME = 'payment_transactions' THEN
    INSERT INTO deleted_payments (source_table, original_id, school_id, amount, payment_mode, payment_date, reference, notes, deleted_by, deletion_reason)
    VALUES ('payment_transactions', OLD.id, OLD.school_id, OLD.payment_amount, OLD.payment_mode, OLD.payment_date, OLD.transaction_reference, OLD.notes, auth.uid(), v_reason);
  END IF;
  RETURN OLD;
END;
$function$;

-- 1-arg version removed so a reason cannot be skipped by calling the old signature
DROP FUNCTION IF EXISTS public.delete_pending_payment_submission(uuid);

CREATE OR REPLACE FUNCTION public.delete_pending_payment_submission(p_submission_id uuid, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub    portal_payment_submissions%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only iPlus superadmins can delete a payment submission';
  END IF;
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required to delete a payment';
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_sub.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending (not yet acknowledged) submissions can be deleted this way — an acknowledged one already affected the school''s payment total and needs a proper reversal instead';
  END IF;

  PERFORM set_config('app.delete_reason', v_reason, true);

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    auth.uid(), 'PORTAL_PAYMENT_SUBMISSION_DELETED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'amount_paid', v_sub.amount_paid,
      'payment_mode', v_sub.payment_mode, 'payment_date', v_sub.payment_date,
      'screenshot_url', v_sub.screenshot_url, 'deletion_reason', v_reason
    )
  );

  DELETE FROM portal_payment_submissions WHERE id = p_submission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_payment_transaction(p_transaction_id uuid, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx     payment_transactions%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only iPlus superadmins can delete a recorded payment';
  END IF;
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required to delete a payment';
  END IF;

  SELECT * INTO v_tx FROM payment_transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  PERFORM set_config('app.delete_reason', v_reason, true);

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    auth.uid(), 'PAYMENT_TRANSACTION_DELETED', 'payment_transactions', p_transaction_id,
    to_jsonb(v_tx),
    jsonb_build_object('deletion_reason', v_reason)
  );

  DELETE FROM payment_transactions WHERE id = p_transaction_id;
  -- trg_sync_payment_status (AFTER DELETE) recomputes the school's payment state.
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_pending_payment_submission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment_transaction(uuid, text)        TO authenticated;

COMMIT;
