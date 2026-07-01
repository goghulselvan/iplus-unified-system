-- =====================================================================
-- LAYER A (functions & triggers only — no large data write yet)
-- =====================================================================

-- 1) Mirror one workflow row → schools (helper)
CREATE OR REPLACE FUNCTION public._mirror_workflow_to_school(p_school_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE w RECORD;
BEGIN
  SELECT * INTO w FROM public.school_project_workflow
   WHERE school_id = p_school_id AND project_id = p_project_id;

  PERFORM set_config('app.workflow_mirror', 'true', true);

  IF NOT FOUND THEN
    UPDATE public.schools SET
      contacted='No', registration_interest=NULL, registration_interest_comment=NULL,
      consent_form_requested='No', consent_form_comment=NULL, consent_form_sent='Not Sent',
      registration_status='Pending', name_list_status='Pending',
      brochure_delivery_status='Physical Only', courier_status='Sent',
      question_paper_sent='Not Sent', answer_sheet_status='Waiting', result_status='Not Sent',
      payment_status='Pending', payment_date=NULL, payment_amount=NULL, payment_mode=NULL,
      payment_received=0, expected_amount=0, per_entry_rate=150, concession_per_entry=0,
      total_participants=NULL, updated_at=now()
    WHERE id = p_school_id;
  ELSE
    UPDATE public.schools SET
      contacted=COALESCE(w.contacted,'No'),
      registration_interest=w.registration_interest,
      registration_interest_comment=w.registration_interest_comment,
      consent_form_requested=COALESCE(w.consent_form_requested,'No'),
      consent_form_comment=w.consent_form_comment,
      consent_form_sent=COALESCE(w.consent_form_sent,'Not Sent'),
      registration_status=COALESCE(w.registration_status,'Pending'),
      name_list_status=COALESCE(w.name_list_status,'Pending'),
      brochure_delivery_status=COALESCE(w.brochure_delivery_status,'Physical Only'),
      courier_status=COALESCE(w.courier_status,'Sent'),
      question_paper_sent=COALESCE(w.question_paper_sent,'Not Sent'),
      answer_sheet_status=COALESCE(w.answer_sheet_status,'Waiting'),
      result_status=COALESCE(w.result_status,'Not Sent'),
      payment_status=COALESCE(w.payment_status,'Pending'),
      payment_date=w.payment_date, payment_amount=w.payment_amount, payment_mode=w.payment_mode,
      payment_received=COALESCE(w.payment_received,0),
      expected_amount=COALESCE(w.expected_amount,0),
      per_entry_rate=COALESCE(w.per_entry_rate,150),
      concession_per_entry=COALESCE(w.concession_per_entry,0),
      total_participants=w.total_participants, updated_at=now()
    WHERE id = p_school_id;
  END IF;

  PERFORM set_config('app.workflow_mirror','false',true);
END;
$$;

-- 2) Trigger: workflow row change → mirror to schools (only if active project)
CREATE OR REPLACE FUNCTION public.mirror_workflow_to_schools()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_current_project uuid;
BEGIN
  SELECT current_project_id INTO v_current_project FROM public.schools WHERE id = NEW.school_id;
  IF v_current_project = NEW.project_id THEN
    PERFORM public._mirror_workflow_to_school(NEW.school_id, NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_workflow_to_schools ON public.school_project_workflow;
CREATE TRIGGER trg_mirror_workflow_to_schools
AFTER INSERT OR UPDATE ON public.school_project_workflow
FOR EACH ROW EXECUTE FUNCTION public.mirror_workflow_to_schools();

-- 3) Bulk rehydrate (used on project switch)
CREATE OR REPLACE FUNCTION public.rehydrate_all_schools_for_project(p_project_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE affected integer := 0;
BEGIN
  PERFORM set_config('app.workflow_mirror','true',true);

  UPDATE public.schools SET current_project_id = p_project_id
   WHERE current_project_id IS DISTINCT FROM p_project_id;

  UPDATE public.schools s SET
    contacted=COALESCE(w.contacted,'No'),
    registration_interest=w.registration_interest,
    registration_interest_comment=w.registration_interest_comment,
    consent_form_requested=COALESCE(w.consent_form_requested,'No'),
    consent_form_comment=w.consent_form_comment,
    consent_form_sent=COALESCE(w.consent_form_sent,'Not Sent'),
    registration_status=COALESCE(w.registration_status,'Pending'),
    name_list_status=COALESCE(w.name_list_status,'Pending'),
    brochure_delivery_status=COALESCE(w.brochure_delivery_status,'Physical Only'),
    courier_status=COALESCE(w.courier_status,'Sent'),
    question_paper_sent=COALESCE(w.question_paper_sent,'Not Sent'),
    answer_sheet_status=COALESCE(w.answer_sheet_status,'Waiting'),
    result_status=COALESCE(w.result_status,'Not Sent'),
    payment_status=COALESCE(w.payment_status,'Pending'),
    payment_date=w.payment_date, payment_amount=w.payment_amount, payment_mode=w.payment_mode,
    payment_received=COALESCE(w.payment_received,0),
    expected_amount=COALESCE(w.expected_amount,0),
    per_entry_rate=COALESCE(w.per_entry_rate,150),
    concession_per_entry=COALESCE(w.concession_per_entry,0),
    total_participants=w.total_participants, updated_at=now()
  FROM public.school_project_workflow w
  WHERE w.school_id = s.id AND w.project_id = p_project_id;

  GET DIAGNOSTICS affected = ROW_COUNT;

  UPDATE public.schools s SET
    contacted='No', registration_interest=NULL, registration_interest_comment=NULL,
    consent_form_requested='No', consent_form_comment=NULL, consent_form_sent='Not Sent',
    registration_status='Pending', name_list_status='Pending',
    brochure_delivery_status='Physical Only', courier_status='Sent',
    question_paper_sent='Not Sent', answer_sheet_status='Waiting', result_status='Not Sent',
    payment_status='Pending', payment_date=NULL, payment_amount=NULL, payment_mode=NULL,
    payment_received=0, expected_amount=0, per_entry_rate=150, concession_per_entry=0,
    total_participants=NULL, updated_at=now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_project_workflow w
    WHERE w.school_id = s.id AND w.project_id = p_project_id
  );

  PERFORM set_config('app.workflow_mirror','false',true);
  RETURN affected;
END;
$$;

-- 4) Switch trigger on olympiad_projects: rehydrate when activated
CREATE OR REPLACE FUNCTION public.handle_active_project_switch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.olympiad_projects
       SET is_active = false, updated_at = now()
     WHERE id <> NEW.id AND is_active = true;
    PERFORM public.rehydrate_all_schools_for_project(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_active_project_switch ON public.olympiad_projects;
CREATE TRIGGER trg_handle_active_project_switch
AFTER INSERT OR UPDATE OF is_active ON public.olympiad_projects
FOR EACH ROW EXECUTE FUNCTION public.handle_active_project_switch();

-- 5) Add project_id to payment_transactions (no backfill yet — done separately)
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS project_id uuid;

CREATE OR REPLACE FUNCTION public.auto_tag_payment_transaction_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.project_id IS NULL THEN
    SELECT current_project_id INTO NEW.project_id FROM public.schools WHERE id = NEW.school_id;
    IF NEW.project_id IS NULL THEN
      SELECT id INTO NEW.project_id FROM public.olympiad_projects WHERE is_active LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tag_payment_transaction_project ON public.payment_transactions;
CREATE TRIGGER trg_auto_tag_payment_transaction_project
BEFORE INSERT ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.auto_tag_payment_transaction_project();

CREATE INDEX IF NOT EXISTS idx_payment_transactions_project
  ON public.payment_transactions (project_id, school_id);
