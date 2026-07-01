CREATE OR REPLACE FUNCTION public.switch_active_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only superadmins can switch the active olympiad project';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  PERFORM set_config('app.workflow_mirror', 'true', true);

  UPDATE public.olympiad_projects
     SET is_active = false
   WHERE id <> p_project_id AND is_active = true;

  UPDATE public.olympiad_projects
     SET is_active = true
   WHERE id = p_project_id AND is_active = false;

  INSERT INTO public.school_project_workflow (school_id, project_id)
  SELECT s.id, p_project_id
    FROM public.schools s
   WHERE NOT EXISTS (
     SELECT 1 FROM public.school_project_workflow w
      WHERE w.school_id = s.id AND w.project_id = p_project_id
   );

  -- Disable user triggers (audit/recalculate/payment-tx/etc.) for this snapshot
  -- mirror only. They exist to react to real user edits, not snapshot copies.
  -- Transaction-local; auto-resets on commit/rollback.
  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.schools s
     SET
       contacted                     = COALESCE(w.contacted, 'No'::contacted_status),
       registration_interest         = w.registration_interest,
       registration_interest_comment = w.registration_interest_comment,
       consent_form_requested        = COALESCE(w.consent_form_requested, 'No'::consent_status),
       consent_form_comment          = w.consent_form_comment,
       consent_form_sent             = COALESCE(w.consent_form_sent, 'Not Sent'),
       registration_status           = COALESCE(w.registration_status, 'Pending'::registration_status),
       name_list_status              = COALESCE(w.name_list_status, 'Pending'::name_list_status),
       brochure_delivery_status      = COALESCE(w.brochure_delivery_status, 'Physical Only'::brochure_delivery_status),
       courier_status                = COALESCE(w.courier_status, 'Sent'::courier_status),
       question_paper_sent           = COALESCE(w.question_paper_sent, 'Not Sent'::question_paper_status),
       answer_sheet_status           = COALESCE(w.answer_sheet_status, 'Waiting'::answer_sheet_status),
       result_status                 = COALESCE(w.result_status, 'Not Sent'::result_status),
       payment_status                = COALESCE(w.payment_status, 'Pending'::payment_status),
       payment_date                  = w.payment_date,
       payment_amount                = w.payment_amount,
       payment_mode                  = w.payment_mode,
       payment_received              = COALESCE(w.payment_received, 0),
       expected_amount               = COALESCE(w.expected_amount, 0),
       per_entry_rate                = COALESCE(w.per_entry_rate, 150),
       concession_per_entry          = COALESCE(w.concession_per_entry, 0),
       total_participants            = COALESCE(w.total_participants, 0),
       current_project_id            = p_project_id
    FROM public.school_project_workflow w
   WHERE w.school_id = s.id
     AND w.project_id = p_project_id
     AND (
       s.current_project_id IS DISTINCT FROM p_project_id
       OR s.contacted                     IS DISTINCT FROM COALESCE(w.contacted, 'No'::contacted_status)
       OR s.registration_interest         IS DISTINCT FROM w.registration_interest
       OR s.registration_interest_comment IS DISTINCT FROM w.registration_interest_comment
       OR s.consent_form_requested        IS DISTINCT FROM COALESCE(w.consent_form_requested, 'No'::consent_status)
       OR s.consent_form_comment          IS DISTINCT FROM w.consent_form_comment
       OR s.consent_form_sent             IS DISTINCT FROM COALESCE(w.consent_form_sent, 'Not Sent')
       OR s.registration_status           IS DISTINCT FROM COALESCE(w.registration_status, 'Pending'::registration_status)
       OR s.name_list_status              IS DISTINCT FROM COALESCE(w.name_list_status, 'Pending'::name_list_status)
       OR s.brochure_delivery_status      IS DISTINCT FROM COALESCE(w.brochure_delivery_status, 'Physical Only'::brochure_delivery_status)
       OR s.courier_status                IS DISTINCT FROM COALESCE(w.courier_status, 'Sent'::courier_status)
       OR s.question_paper_sent           IS DISTINCT FROM COALESCE(w.question_paper_sent, 'Not Sent'::question_paper_status)
       OR s.answer_sheet_status           IS DISTINCT FROM COALESCE(w.answer_sheet_status, 'Waiting'::answer_sheet_status)
       OR s.result_status                 IS DISTINCT FROM COALESCE(w.result_status, 'Not Sent'::result_status)
       OR s.payment_status                IS DISTINCT FROM COALESCE(w.payment_status, 'Pending'::payment_status)
       OR s.payment_date                  IS DISTINCT FROM w.payment_date
       OR s.payment_amount                IS DISTINCT FROM w.payment_amount
       OR s.payment_mode                  IS DISTINCT FROM w.payment_mode
       OR s.payment_received              IS DISTINCT FROM COALESCE(w.payment_received, 0)
       OR s.expected_amount               IS DISTINCT FROM COALESCE(w.expected_amount, 0)
       OR s.per_entry_rate                IS DISTINCT FROM COALESCE(w.per_entry_rate, 150)
       OR s.concession_per_entry          IS DISTINCT FROM COALESCE(w.concession_per_entry, 0)
       OR s.total_participants            IS DISTINCT FROM COALESCE(w.total_participants, 0)
     );

  PERFORM set_config('session_replication_role', 'origin', true);
END
$function$;

ALTER FUNCTION public.switch_active_project(uuid) SET statement_timeout = '120s';