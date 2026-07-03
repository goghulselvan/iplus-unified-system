-- When school_project_workflow is updated directly (via useUpdateSchoolWorkflow or BulkStageDialog),
-- sync status fields back to schools and touch updated_at so get_dashboard_metrics_by_date can
-- find the school in its updated_at date filter.
-- Skip sync when called from update_school_with_manual_edit (which already updates both tables).

CREATE OR REPLACE FUNCTION public.sync_workflow_to_schools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip when called from update_school_with_manual_edit (already syncs both)
  IF current_setting('app.manual_edit_mode', true) = 'true' THEN
    RETURN NEW;
  END IF;

  UPDATE public.schools SET
    contacted              = COALESCE(NEW.contacted,              contacted),
    registration_interest  = COALESCE(NEW.registration_interest,  registration_interest),
    consent_form_requested = COALESCE(NEW.consent_form_requested, consent_form_requested),
    consent_form_sent      = COALESCE(NEW.consent_form_sent,      consent_form_sent),
    registration_status    = COALESCE(NEW.registration_status,    registration_status),
    name_list_status       = COALESCE(NEW.name_list_status,       name_list_status),
    payment_status         = COALESCE(NEW.payment_status,         payment_status),
    payment_amount         = COALESCE(NEW.payment_amount,         payment_amount),
    payment_mode           = COALESCE(NEW.payment_mode,           payment_mode),
    courier_status         = COALESCE(NEW.courier_status,         courier_status),
    question_paper_sent    = COALESCE(NEW.question_paper_sent,    question_paper_sent),
    answer_sheet_status    = COALESCE(NEW.answer_sheet_status,    answer_sheet_status),
    result_status          = COALESCE(NEW.result_status,          result_status),
    brochure_delivery_status = COALESCE(NEW.brochure_delivery_status, brochure_delivery_status),
    updated_at             = now()
  WHERE id = NEW.school_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_workflow_to_schools ON public.school_project_workflow;

CREATE TRIGGER trg_sync_workflow_to_schools
AFTER UPDATE ON public.school_project_workflow
FOR EACH ROW
EXECUTE FUNCTION public.sync_workflow_to_schools();
