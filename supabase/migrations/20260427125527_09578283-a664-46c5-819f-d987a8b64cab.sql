
CREATE OR REPLACE FUNCTION public.switch_active_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Permission check: only superadmins
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only superadmins can switch the active olympiad project';
  END IF;

  -- Verify project exists
  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  -- Mirror mode for the rest of this transaction
  PERFORM set_config('app.workflow_mirror', 'true', true);

  -- 1. Deactivate all other projects first (avoids unique-active-index conflict)
  UPDATE public.olympiad_projects SET is_active = false WHERE id <> p_project_id AND is_active = true;

  -- 2. Activate the target project
  UPDATE public.olympiad_projects SET is_active = true WHERE id = p_project_id;

  -- 3. Ensure a workflow row exists for every school in this project
  INSERT INTO public.school_project_workflow (school_id, project_id)
  SELECT s.id, p_project_id
  FROM public.schools s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_project_workflow w
    WHERE w.school_id = s.id AND w.project_id = p_project_id
  );

  -- 4. Rehydrate the schools mirror columns from the active project's workflow rows
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
    current_project_id        = p_project_id
  FROM public.school_project_workflow w
  WHERE w.school_id = s.id AND w.project_id = p_project_id;
END
$$;

REVOKE ALL ON FUNCTION public.switch_active_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_active_project(uuid) TO authenticated;
