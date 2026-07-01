-- Make participants count strictly project-scoped.

-- 1. Recompute every workflow row's total_participants from actual data per project.
--    Use 0 (not NULL) so the mirror never falls back to a stale value.
UPDATE public.school_project_workflow w
SET total_participants = COALESCE(sub.cnt, 0),
    updated_at = now()
FROM (
  SELECT w2.school_id, w2.project_id,
         (SELECT COUNT(ss.id)
            FROM public.student_registrations sr
            JOIN public.student_subjects ss ON ss.registration_id = sr.id
           WHERE sr.school_id = w2.school_id
             AND sr.project_id = w2.project_id
             AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%'
         ) AS cnt
  FROM public.school_project_workflow w2
) sub
WHERE w.school_id = sub.school_id
  AND w.project_id = sub.project_id
  AND (w.total_participants IS DISTINCT FROM COALESCE(sub.cnt, 0));

-- 2. Re-mirror schools.total_participants from the active project's workflow row.
UPDATE public.schools s
SET total_participants = COALESCE(w.total_participants, 0),
    updated_at = now()
FROM public.school_project_workflow w
WHERE w.school_id = s.id
  AND w.project_id = s.current_project_id
  AND (s.total_participants IS DISTINCT FROM COALESCE(w.total_participants, 0));

-- For schools whose current project has no workflow row at all, zero them.
UPDATE public.schools s
SET total_participants = 0, updated_at = now()
WHERE s.current_project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.school_project_workflow w
    WHERE w.school_id = s.id AND w.project_id = s.current_project_id
  )
  AND COALESCE(s.total_participants, -1) IS DISTINCT FROM 0;

-- 3. Per-project trigger: count for the (school, project) pair the row belongs to,
--    update that workflow row, and mirror to schools only if it is the active project.
CREATE OR REPLACE FUNCTION public.update_total_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected_school_id uuid;
  affected_project_id uuid;
  participation_count integer;
  v_current_project uuid;
BEGIN
  IF TG_TABLE_NAME = 'student_registrations' THEN
    IF TG_OP = 'DELETE' THEN
      affected_school_id := OLD.school_id;
      affected_project_id := OLD.project_id;
    ELSE
      affected_school_id := NEW.school_id;
      affected_project_id := NEW.project_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'student_subjects' THEN
    IF TG_OP = 'DELETE' THEN
      SELECT school_id, project_id INTO affected_school_id, affected_project_id
        FROM public.student_registrations WHERE id = OLD.registration_id;
    ELSE
      SELECT school_id, project_id INTO affected_school_id, affected_project_id
        FROM public.student_registrations WHERE id = NEW.registration_id;
    END IF;
  END IF;

  IF affected_school_id IS NULL OR affected_project_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO participation_count
  FROM public.student_subjects ss
  INNER JOIN public.student_registrations sr ON ss.registration_id = sr.id
  WHERE sr.school_id = affected_school_id
    AND sr.project_id = affected_project_id
    AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%';

  UPDATE public.school_project_workflow
     SET total_participants = participation_count, updated_at = now()
   WHERE school_id = affected_school_id AND project_id = affected_project_id;

  SELECT current_project_id INTO v_current_project
    FROM public.schools WHERE id = affected_school_id;

  IF v_current_project = affected_project_id THEN
    UPDATE public.schools
       SET total_participants = participation_count, updated_at = now()
     WHERE id = affected_school_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- 4. Mirror should reflect the workflow row exactly (0 when no participants),
--    not retain the previous project's value.
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
      total_participants=0, updated_at=now()
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
      total_participants=COALESCE(w.total_participants, 0),
      updated_at=now()
    WHERE id = p_school_id;
  END IF;

  PERFORM set_config('app.workflow_mirror','false',true);
END;
$$;

-- 5. Same fix for bulk rehydration on project switch.
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
    total_participants=COALESCE(w.total_participants, 0),
    updated_at=now()
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
    total_participants=0, updated_at=now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_project_workflow w
    WHERE w.school_id = s.id AND w.project_id = p_project_id
  );

  PERFORM set_config('app.workflow_mirror','false',true);
  RETURN affected;
END;
$$;