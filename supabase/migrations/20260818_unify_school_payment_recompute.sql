-- Unify school payment-status calculation. Before this migration there were THREE
-- independent, disconnected implementations that disagreed with each other:
--   1. sync_payment_status()              — fired on payment_transactions changes,
--      read per_entry_rate/concession_per_entry, wrote payment_status+payment_received
--      only (never touched expected_amount/outstanding_balance/total_participants).
--   2. recompute_school_payment_state()   — fired on portal_student_enrollments
--      changes, read the DIFFERENT rate_per_entry/concession_amount columns, and
--      used different Overpaid-vs-Received logic on the same numbers.
--   3. recalculate_school_payment_totals() — called directly from the frontend after
--      every "Add Payment" click, hardcoded a single project_id, read the same
--      rate_per_entry/concession_amount columns as #2, with yet another status-logic
--      variant.
-- None of these called each other, so whichever fired last — and for #1/#3, whichever
-- ran last within the same click — is what staff saw, and #2/#3's rate/concession
-- columns aren't even the ones staff actually edit (per_entry_rate/concession_per_entry
-- is; confirmed via PortalRegistrationView.tsx's rate-edit upsert). Root-caused via a
-- real dispute: a manual/offline school (Parimalam, SS 10613) paid before its name
-- list arrived by courier, and nothing ever recomputed its status once the two functions'
-- writes landed inconsistently on schools vs school_project_workflow.
--
-- Fix: recompute_school_payment_state(school_id, project_id) becomes the SINGLE
-- canonical calculation, called from every event that should trigger a recompute —
-- a payment changing, an enrollment changing, or a name-list submission — reading the
-- columns staff actually edit, with one consistent status rule.
--
-- recalculate_school_payment_totals is kept as a thin backward-compatible shim (not
-- dropped) because the currently-LIVE CRM frontend bundle still calls it directly on
-- every Add Payment click, and won't pick up the updated frontend until the next
-- staging->live promotion — dropping it now would break live payment entry in the
-- meantime. It now just delegates to the unified function instead of duplicating logic.

CREATE OR REPLACE FUNCTION public.recompute_school_payment_state(p_school_id uuid, p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count       integer;
  v_rate        numeric;
  v_concession  numeric;
  v_expected    numeric;
  v_received    numeric;
  v_outstanding numeric;
  v_status      payment_status;
BEGIN
  SELECT COUNT(pse.id) INTO v_count
  FROM portal_student_enrollments pse
  JOIN portal_registered_students prs ON prs.id = pse.student_id
  WHERE prs.school_id = p_school_id AND prs.project_id = p_project_id;
  v_count := COALESCE(v_count, 0);

  SELECT COALESCE(w.per_entry_rate, 150), COALESCE(w.concession_per_entry, 0)
  INTO v_rate, v_concession
  FROM school_project_workflow w
  WHERE w.school_id = p_school_id AND w.project_id = p_project_id;
  -- SELECT INTO sets targets to NULL on zero matching rows (no workflow row yet) —
  -- the COALESCE above only helps once a row exists, so re-coalesce here too.
  v_rate := COALESCE(v_rate, 150);
  v_concession := COALESCE(v_concession, 0);

  v_expected := GREATEST(0, v_count::numeric * (v_rate - v_concession));

  SELECT COALESCE(SUM(payment_amount), 0) INTO v_received
  FROM payment_transactions WHERE school_id = p_school_id;

  v_outstanding := GREATEST(0, v_expected - v_received);

  -- expected = 0 (no name list yet) with something already paid resolves to
  -- 'Received' (paid, nothing currently owed), not 'Overpaid' — matches
  -- isAwaitingNameList's existing UI treatment of this exact case
  -- (src/utils/paymentStatusDisplay.ts), which overlays a friendlier label on
  -- top of this same raw status.
  v_status := CASE
    WHEN v_received <= 0                            THEN 'Pending'::payment_status
    WHEN v_expected > 0 AND v_received < v_expected  THEN 'Partial'::payment_status
    WHEN v_expected > 0 AND v_received > v_expected  THEN 'Overpaid'::payment_status
    ELSE                                                   'Received'::payment_status
  END;

  UPDATE schools
  SET expected_amount     = v_expected,
      payment_received    = v_received,
      outstanding_balance = v_outstanding,
      payment_status      = v_status,
      total_participants  = v_count,
      updated_at          = now()
  WHERE id = p_school_id;

  INSERT INTO school_project_workflow (
    school_id, project_id, expected_amount, payment_received, outstanding_balance, payment_status, total_participants
  ) VALUES (
    p_school_id, p_project_id, v_expected, v_received, v_outstanding, v_status, v_count
  )
  ON CONFLICT (school_id, project_id) DO UPDATE
  SET expected_amount     = EXCLUDED.expected_amount,
      payment_received    = EXCLUDED.payment_received,
      outstanding_balance = EXCLUDED.outstanding_balance,
      payment_status      = EXCLUDED.payment_status,
      total_participants  = EXCLUDED.total_participants,
      updated_at          = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recompute_school_payment_state(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_school_payment_state(uuid, uuid) TO authenticated, service_role;

-- The payment_transactions trigger now calls the unified function instead of the
-- retired sync_payment_status. Trigger definition itself (WHEN it fires) is unchanged.
CREATE OR REPLACE FUNCTION public.trg_fn_sync_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school_id  uuid;
  v_project_id uuid;
BEGIN
  v_school_id := COALESCE(NEW.school_id, OLD.school_id);

  -- Determine project from workflow (most recent active) — same heuristic this
  -- trigger has always used; payment_transactions itself carries no project_id.
  SELECT project_id INTO v_project_id
  FROM school_project_workflow
  WHERE school_id = v_school_id
  ORDER BY updated_at DESC LIMIT 1;

  IF v_project_id IS NOT NULL THEN
    PERFORM recompute_school_payment_state(v_school_id, v_project_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

-- Retired: sync_payment_status. Only ever called from trg_fn_sync_payment_status,
-- which no longer references it — safe to drop, nothing else calls it by name.
DROP FUNCTION IF EXISTS public.sync_payment_status(uuid, uuid);

-- Backward-compatible shim for the currently-live frontend build, which still calls
-- this directly after every Add Payment click. Delegates to the unified function
-- instead of duplicating its own (buggy, hardcoded-project) logic. Safe to remove in
-- a future migration once the updated frontend (which stops calling this) is
-- confirmed live.
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id CONSTANT uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
BEGIN
  PERFORM recompute_school_payment_state(p_school_id, v_project_id);
END;
$function$;

-- submit_student_list: add the missing link. Submitting/updating a name list now
-- also recomputes payment state, so a school that paid before its list arrived
-- (or whose count changes for any other reason) gets a correct status the moment
-- the list is entered — not just the next time a payment_transactions row changes.
-- Body otherwise identical to the existing live definition.
CREATE OR REPLACE FUNCTION public.submit_student_list(p_school_id uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deadline timestamptz;
  v_prev_submitted_at timestamptz;
  v_new_count int;
  v_total_count int;
  v_fee   numeric;
  v_rate  numeric := 150;
BEGIN
  SELECT registration_deadline INTO v_deadline
  FROM olympiad_projects WHERE id = p_project_id;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RETURN jsonb_build_object('error', 'Registration deadline has passed');
  END IF;

  IF p_school_id != get_portal_school_id() AND NOT is_superadmin() THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT list_submitted_at INTO v_prev_submitted_at
  FROM school_project_workflow
  WHERE school_id = p_school_id AND project_id = p_project_id;

  -- Backfill any legacy NULL submitted_at (pre-dates the eager insert-time
  -- stamp) so the registration-number trigger still picks them up. Not used
  -- for counting below anymore.
  UPDATE portal_student_enrollments e
  SET submitted_at = now()
  FROM portal_registered_students s
  WHERE e.student_id = s.id
    AND s.school_id  = p_school_id
    AND s.project_id = p_project_id
    AND e.submitted_at IS NULL;

  -- New-this-round count: enrollments belonging to students created after
  -- the previous submission (or everyone, on a school's first submission).
  SELECT COUNT(*) INTO v_new_count
  FROM portal_student_enrollments e
  JOIN portal_registered_students s ON s.id = e.student_id
  WHERE s.school_id = p_school_id
    AND s.project_id = p_project_id
    AND (v_prev_submitted_at IS NULL OR s.created_at > v_prev_submitted_at);

  -- True cumulative total, live-counted (not accumulated/overwritten).
  SELECT COUNT(*) INTO v_total_count
  FROM portal_student_enrollments e
  JOIN portal_registered_students s ON s.id = e.student_id
  WHERE s.school_id = p_school_id AND s.project_id = p_project_id;

  SELECT COALESCE(rate_per_entry, 150) INTO v_rate
  FROM school_project_workflow
  WHERE school_id = p_school_id AND project_id = p_project_id;
  -- SELECT INTO sets the target to NULL when zero rows match (no workflow
  -- row yet) — the COALESCE above only helps once a row exists.
  v_rate := COALESCE(v_rate, 150);

  v_fee := v_new_count * v_rate;

  UPDATE schools SET
    total_participants = v_total_count,
    name_list_status    = 'Uploaded'
  WHERE id = p_school_id;

  INSERT INTO school_project_workflow (school_id, project_id, rate_per_entry, concession_amount, payment_status, list_submitted_at, name_list_status, total_participants)
  VALUES (p_school_id, p_project_id, v_rate, 0, 'Pending', now(), 'Uploaded', v_total_count)
  ON CONFLICT (school_id, project_id) DO UPDATE
  SET list_submitted_at  = now(),
      name_list_status   = 'Uploaded',
      total_participants = v_total_count;

  PERFORM recompute_school_payment_state(p_school_id, p_project_id);

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    auth.uid(),
    'PORTAL_STUDENT_LIST_SUBMITTED',
    'school_project_workflow',
    NULL,
    jsonb_build_object(
      'school_id', p_school_id,
      'project_id', p_project_id,
      'new_this_round', v_new_count,
      'total_participants', v_total_count,
      'fee_this_round', v_fee
    )
  );

  RETURN jsonb_build_object('success', true, 'submitted', v_new_count, 'total', v_total_count, 'fee', v_fee, 'rate', v_rate);
END;
$function$;

-- acknowledge_portal_payment: no longer maintains its own inline copy of the
-- expected/status math. Inserting into payment_transactions already triggers the
-- unified recompute; this just calls it explicitly with the project_id it already
-- knows (rather than relying on the trigger's multi-project "most recent" guess),
-- then reads the authoritative result back for its return payload and audit log.
-- registration_status handling (specific to this portal-review flow, not a general
-- payment concept) stays local to this function.
CREATE OR REPLACE FUNCTION public.acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid, p_verified_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub             portal_payment_submissions%ROWTYPE;
  v_expected        numeric;
  v_total_paid      numeric;
  v_new_status      payment_status;
  v_list_submitted  boolean;
  v_tx_id           uuid;
  v_project_id CONSTANT uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
BEGIN
  IF NOT is_crm_user() THEN
    RETURN jsonb_build_object('error', 'Unauthorized: CRM access required');
  END IF;

  IF p_verified_amount IS NULL OR p_verified_amount < 0 THEN
    RETURN jsonb_build_object('error', 'A valid verified amount is required');
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Submission already processed');
  END IF;

  UPDATE portal_payment_submissions
  SET status = 'acknowledged', acknowledged_by = p_admin_user_id, acknowledged_at = now(),
      verified_amount = p_verified_amount
  WHERE id = p_submission_id;

  INSERT INTO payment_transactions (
    school_id, project_id, payment_date, payment_amount,
    payment_mode, transaction_reference, notes, created_by
  ) VALUES (
    v_sub.school_id, v_sub.project_id, v_sub.payment_date, p_verified_amount,
    v_sub.payment_mode, v_sub.utr_reference, v_sub.notes, p_admin_user_id
  )
  RETURNING id INTO v_tx_id;

  PERFORM recompute_school_payment_state(v_sub.school_id, v_project_id);

  SELECT payment_received, payment_status, expected_amount
  INTO v_total_paid, v_new_status, v_expected
  FROM schools WHERE id = v_sub.school_id;

  SELECT (list_submitted_at IS NOT NULL) INTO v_list_submitted
  FROM school_project_workflow
  WHERE school_id = v_sub.school_id AND project_id = v_project_id;

  UPDATE school_project_workflow
  SET registration_status = CASE
                              WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                              THEN 'Confirmed'::registration_status
                              ELSE registration_status
                            END
  WHERE school_id = v_sub.school_id AND project_id = v_project_id;

  UPDATE schools
  SET registration_status  = CASE
                               WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                               THEN 'Confirmed'
                               ELSE registration_status
                             END
  WHERE id = v_sub.school_id;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_admin_user_id, 'PORTAL_PAYMENT_ACKNOWLEDGED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'declared_amount', v_sub.amount_paid,
      'verified_amount', p_verified_amount, 'amount_mismatch', (p_verified_amount <> v_sub.amount_paid),
      'payment_mode', v_sub.payment_mode, 'new_status', v_new_status,
      'total_paid', v_total_paid, 'expected', v_expected,
      'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_status', v_new_status::text,
    'total_paid', v_total_paid,
    'expected', v_expected,
    'transaction_id', v_tx_id,
    'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
  );
END;
$function$;

-- One-time backfill: correct every existing school+project row's stored payment
-- state under the unified calculation, so schools already drifted (Parimalam, and
-- any other school in the same pay-before-namelist situation) are fixed immediately
-- rather than only going forward.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT school_id, project_id FROM school_project_workflow LOOP
    PERFORM recompute_school_payment_state(r.school_id, r.project_id);
  END LOOP;
END $$;
