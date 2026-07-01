
DO $$
DECLARE
  v_active_project uuid;
BEGIN
  -- Enable mirror mode for this transaction so audit/validation triggers short-circuit
  PERFORM set_config('app.workflow_mirror', 'true', true);

  -- Get the active project
  SELECT id INTO v_active_project FROM public.olympiad_projects WHERE is_active = true LIMIT 1;

  -- 1. Backfill payment_transactions.project_id from schools.current_project_id
  UPDATE public.payment_transactions pt
  SET project_id = s.current_project_id
  FROM public.schools s
  WHERE pt.school_id = s.id
    AND pt.project_id IS NULL
    AND s.current_project_id IS NOT NULL;

  -- 2. Backfill activity_logs.project_id from schools.current_project_id
  UPDATE public.activity_logs al
  SET project_id = s.current_project_id
  FROM public.schools s
  WHERE al.school_id = s.id
    AND al.project_id IS NULL
    AND s.current_project_id IS NOT NULL;

  -- 3. Rehydrate schools mirror columns from school_project_workflow for the ACTIVE project
  IF v_active_project IS NOT NULL THEN
    UPDATE public.schools s
    SET
      contacted                 = COALESCE(w.contacted, 'No'::contacted_status),
      registration_interest     = w.registration_interest,
      registration_interest_comment = w.registration_interest_comment,
      consent_form_requested    = COALESCE(w.consent_form_requested, 'No'::consent_status),
      consent_form_comment      = w.consent_form_comment,
      consent_form_sent         = COALESCE(w.consent_form_sent, 'Not Sent'),
      registration_status       = COALESCE(w.registration_status, 'Pending'::registration_status),
      name_list_status          = COALESCE(w.name_list_status, 'Pending'::name_list_status),
      brochure_delivery_status  = COALESCE(w.brochure_delivery_status, 'Physical Only'::brochure_delivery_status),
      courier_status            = COALESCE(w.courier_status, 'Sent'::courier_status),
      question_paper_sent       = COALESCE(w.question_paper_sent, 'Not Sent'::question_paper_status),
      answer_sheet_status       = COALESCE(w.answer_sheet_status, 'Waiting'::answer_sheet_status),
      result_status             = COALESCE(w.result_status, 'Not Sent'::result_status),
      payment_status            = COALESCE(w.payment_status, 'Pending'::payment_status),
      payment_date              = w.payment_date,
      payment_amount            = w.payment_amount,
      payment_mode              = w.payment_mode,
      payment_received          = COALESCE(w.payment_received, 0),
      expected_amount           = COALESCE(w.expected_amount, 0),
      per_entry_rate            = COALESCE(w.per_entry_rate, 150),
      concession_per_entry      = COALESCE(w.concession_per_entry, 0),
      total_participants        = w.total_participants,
      current_project_id        = v_active_project
    FROM public.school_project_workflow w
    WHERE w.school_id = s.id
      AND w.project_id = v_active_project;
  END IF;
END
$$;
