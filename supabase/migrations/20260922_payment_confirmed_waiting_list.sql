-- Payment-gated "Confirmed vs Waiting" namelist status.
--
-- Real incident that triggered this: a school had 21 students added to its
-- namelist, then declined to pay ("dropping out") after staff had already
-- done the data entry — those 21 stayed counted in the dashboard/question-
-- paper totals until manually deleted. Audit on 2026-09-22 found 6 more
-- schools already in the identical state (756 students, zero payment,
-- name_list_status='Uploaded').
--
-- New rule: how many of a school's entered subject-enrollments are actually
-- "Confirmed" is capped by how much has been paid (oldest-entered first).
-- Anything beyond that sits as "Waiting" — visible, but excluded from
-- dashboard/namelist counts. This does NOT change what a school owes
-- (v_count / expected_amount stays the full entered count, unaffected) —
-- only which entries count as real registrations right now.

ALTER TABLE portal_student_enrollments
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS confirmed_participants integer NOT NULL DEFAULT 0;

ALTER TABLE school_project_workflow
  ADD COLUMN IF NOT EXISTS confirmed_participants integer NOT NULL DEFAULT 0;

-- Extend the existing single source of truth for payment/participant math
-- (already fires on every payment change, enrollment change, and
-- submit_student_list — see feedback_schools_workflow_dual_table item 6)
-- to also compute and stamp the Confirmed/Waiting split, instead of adding
-- a brand new trigger that could drift from this one.
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
  v_net_rate    numeric;
  v_expected    numeric;
  v_received    numeric;
  v_outstanding numeric;
  v_status      payment_status;
  v_confirmed   integer;
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
  -- SELECT INTO sets targets to NULL on zero matching rows (no workflow
  -- row yet) — the COALESCE above only helps once a row exists, so re-coalesce here too.
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

  -- How many entries the payment actually covers, oldest-entered first.
  -- A fully-waived rate (net rate <= 0) means nothing is owed, so every
  -- entry is confirmed regardless of payment.
  v_net_rate := v_rate - v_concession;
  IF v_net_rate <= 0 THEN
    v_confirmed := v_count;
  ELSE
    v_confirmed := LEAST(v_count, FLOOR(v_received / v_net_rate)::int);
  END IF;

  WITH ordered AS (
    SELECT pse.id, row_number() OVER (ORDER BY pse.created_at, pse.id) AS rn
    FROM portal_student_enrollments pse
    JOIN portal_registered_students prs ON prs.id = pse.student_id
    WHERE prs.school_id = p_school_id AND prs.project_id = p_project_id
  )
  UPDATE portal_student_enrollments pse
  SET is_confirmed = (ordered.rn <= v_confirmed)
  FROM ordered
  WHERE pse.id = ordered.id
    AND pse.is_confirmed IS DISTINCT FROM (ordered.rn <= v_confirmed);

  UPDATE schools
  SET expected_amount        = v_expected,
      payment_received       = v_received,
      outstanding_balance    = v_outstanding,
      payment_status         = v_status,
      total_participants     = v_count,
      confirmed_participants = v_confirmed,
      updated_at              = now()
  WHERE id = p_school_id;

  INSERT INTO school_project_workflow (
    school_id, project_id, expected_amount, payment_received, outstanding_balance, payment_status, total_participants, confirmed_participants
  ) VALUES (
    p_school_id, p_project_id, v_expected, v_received, v_outstanding, v_status, v_count, v_confirmed
  )
  ON CONFLICT (school_id, project_id) DO UPDATE
  SET expected_amount        = EXCLUDED.expected_amount,
      payment_received       = EXCLUDED.payment_received,
      outstanding_balance    = EXCLUDED.outstanding_balance,
      payment_status         = EXCLUDED.payment_status,
      total_participants     = EXCLUDED.total_participants,
      confirmed_participants = EXCLUDED.confirmed_participants,
      updated_at              = now();
END;
$function$;

-- One-time backfill so every school/project pair that already has a
-- workflow row gets a correct is_confirmed/confirmed_participants value
-- immediately (Goghul's explicit call: apply retroactively, don't
-- grandfather the 6 already-exposed schools).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT school_id, project_id FROM school_project_workflow LOOP
    PERFORM recompute_school_payment_state(r.school_id, r.project_id);
  END LOOP;
END $$;

-- Dashboard "Total Registrations" — only count Confirmed enrollments.
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project_with_access(p_project_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_schools bigint, contacted_yes bigint, contacted_no bigint, registration_interested bigint, registration_not_interested bigint, registration_in_progress bigint, registration_pending bigint, registration_confirmed bigint, consent_requested bigint, consent_count_pending bigint, consent_form_sent_total bigint, consent_form_sent_physical bigint, consent_form_sent_digital bigint, courier_sent bigint, courier_returned bigint, name_list_received bigint, name_list_uploaded bigint, payment_received bigint, question_paper_sent bigint, answer_sheet_received bigint, result_sent bigint, brochure_physical_only bigint, brochure_digital_sent bigint, brochure_both_physical_digital bigint, total_registrations bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH accessible_schools AS (
    SELECT
      s.id AS school_id,
      COALESCE(w.contacted::text,                  s.contacted::text)                  AS s_contacted,
      COALESCE(w.registration_interest::text,      s.registration_interest::text)      AS s_registration_interest,
      COALESCE(w.registration_status::text,        s.registration_status::text)        AS s_registration_status,
      COALESCE(w.consent_form_requested::text,     s.consent_form_requested::text)     AS s_consent_form_requested,
      COALESCE(w.consent_form_sent,                s.consent_form_sent)                AS s_consent_form_sent,
      COALESCE(w.courier_status::text,             s.courier_status::text)             AS s_courier_status,
      COALESCE(w.name_list_status::text,           s.name_list_status::text)           AS s_name_list_status,
      COALESCE(w.payment_status::text,             s.payment_status::text)             AS s_payment_status,
      COALESCE(w.question_paper_sent::text,        s.question_paper_sent::text)        AS s_question_paper_sent,
      COALESCE(w.answer_sheet_status::text,        s.answer_sheet_status::text)        AS s_answer_sheet_status,
      COALESCE(w.result_status::text,              s.result_status::text)              AS s_result_status,
      COALESCE(w.brochure_delivery_status::text,   s.brochure_delivery_status::text)   AS s_brochure_delivery_status,
      cf.forms_requested AS s_forms_requested
    FROM schools s
    LEFT JOIN school_project_workflow w
      ON w.school_id = s.id AND w.project_id = p_project_id
    LEFT JOIN consent_forms cf
      ON cf.school_id = s.id AND cf.project_id = p_project_id
    WHERE can_access_school_data(s.district)
      AND (
        (p_project_id IS NOT NULL AND w.id IS NOT NULL)
        OR p_project_id IS NULL
      )
  ),
  registration_count AS (
    SELECT COUNT(e.id) AS cnt
    FROM portal_student_enrollments e
    JOIN portal_registered_students r ON r.id = e.student_id
    JOIN accessible_schools a ON a.school_id = r.school_id
    WHERE (p_project_id IS NULL OR r.project_id = p_project_id)
      AND e.is_confirmed = true
  )
  SELECT
    COUNT(*)::bigint AS total_schools,
    COUNT(*) FILTER (WHERE a.s_contacted = 'Yes')::bigint,
    COUNT(*) FILTER (WHERE a.s_contacted = 'No')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Interested')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Not Interested')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'In Progress')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Pending')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Confirmed')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_requested = 'Yes')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_requested = 'Yes' AND COALESCE(a.s_forms_requested, 0) = 0)::bigint AS consent_count_pending,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent IN ('Sent', 'Sent Digitally'))::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent Digitally')::bigint,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Returned')::bigint,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Received')::bigint,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Uploaded')::bigint,
    COUNT(*) FILTER (WHERE a.s_payment_status IN ('Received', 'Overpaid'))::bigint AS payment_received,
    COUNT(*) FILTER (WHERE a.s_question_paper_sent = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_answer_sheet_status = 'Received')::bigint,
    COUNT(*) FILTER (WHERE a.s_result_status = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Physical Only')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Digital Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Both Physical & Digital')::bigint,
    (SELECT cnt FROM registration_count)::bigint AS total_registrations
  FROM accessible_schools a;
END;
$function$;

-- Dashboard "Total Students" — only distinct students with at least one
-- Confirmed enrollment.
CREATE OR REPLACE FUNCTION public.get_total_students_count(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_user_id uuid := auth.uid();
  v_access_level text;
  v_districts text[];
BEGIN
  SELECT data_access_level, assigned_districts
  INTO v_access_level, v_districts
  FROM public.profiles WHERE user_id = v_user_id;

  SELECT COUNT(DISTINCT r.id) INTO v_count
  FROM public.portal_registered_students r
  JOIN public.schools sc ON sc.id = r.school_id
  JOIN public.portal_student_enrollments pse ON pse.student_id = r.id
  WHERE r.project_id = p_project_id
    AND pse.is_confirmed = true
    AND (
      public.is_superadmin()
      OR v_access_level = 'full'
      OR v_access_level IS NULL
      OR (v_access_level = 'regional' AND (
        v_districts IS NULL OR 'ALL' = ANY(v_districts) OR sc.district = ANY(v_districts)
      ))
    );

  RETURN COALESCE(v_count, 0);
END;
$function$;

-- Portal Submit gate — a school can't finalize/submit its list until iPlus
-- staff have acknowledged at least one payment. A raw uploaded payment proof
-- (portal_payment_submissions, status='pending') does NOT count — only
-- acknowledge_portal_payment() inserts into payment_transactions, which is
-- the only thing payment_received is ever summed from. So this check is
-- already, by construction, "acknowledged by staff", not "proof uploaded".
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
  v_payment_received numeric;
BEGIN
  SELECT registration_deadline INTO v_deadline
  FROM olympiad_projects WHERE id = p_project_id;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RETURN jsonb_build_object('error', 'Registration deadline has passed');
  END IF;

  IF p_school_id != get_portal_school_id() AND NOT is_superadmin() THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT payment_received INTO v_payment_received
  FROM school_project_workflow
  WHERE school_id = p_school_id AND project_id = p_project_id;

  IF COALESCE(v_payment_received, 0) <= 0 THEN
    RETURN jsonb_build_object('error', 'A payment must be received and acknowledged by iPlus staff before the student list can be submitted. Please make a payment on the Payment page first.');
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
