-- Superadmin-only cleanup for a wrongly-submitted payment proof (e.g. school
-- attaches the wrong screenshot, then resubmits correctly). Deliberately
-- scoped to PENDING submissions only — an acknowledged one already created a
-- payment_transactions row and fed schools.payment_received via
-- recompute_school_payment_state(), so deleting it here would silently leave
-- the school's totals wrong. If an already-acknowledged submission genuinely
-- needs reversing, that's a separate, more careful operation (must also
-- delete/void the linked transaction and recompute) — not this function.
CREATE OR REPLACE FUNCTION public.delete_pending_payment_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub portal_payment_submissions%ROWTYPE;
BEGIN
  IF NOT is_superadmin(auth.uid()) THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.delete_pending_payment_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_pending_payment_submission(uuid) TO authenticated, service_role;
