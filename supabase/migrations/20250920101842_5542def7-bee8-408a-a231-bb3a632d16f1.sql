-- Drop the current function and recreate the original working version
DROP FUNCTION IF EXISTS public.get_dashboard_metrics_by_project(uuid);

-- Recreate the original dashboard function without NULL project handling
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project(p_project_id uuid)
RETURNS TABLE(
  total_schools bigint,
  courier_sent bigint,
  courier_returned bigint,
  contacted_yes bigint,
  contacted_no bigint,
  registration_interested bigint,
  registration_not_interested bigint,
  consent_requested bigint,
  consent_form_sent_total bigint,
  consent_form_sent_physical bigint,
  consent_form_sent_digital bigint,
  registration_confirmed bigint,
  registration_in_progress bigint,
  name_list_received bigint,
  name_list_uploaded bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  total_registrations bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COUNT(*) as total_schools,
    COUNT(*) FILTER (WHERE s.courier_status = 'Sent') as courier_sent,
    COUNT(*) FILTER (WHERE s.courier_status = 'Returned') as courier_returned,
    COUNT(*) FILTER (WHERE s.contacted = 'Yes') as contacted_yes,
    COUNT(*) FILTER (WHERE s.contacted = 'No') as contacted_no,
    COUNT(*) FILTER (WHERE s.registration_interest = 'Interested') as registration_interested,
    COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested') as registration_not_interested,
    COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes') as consent_requested,
    COUNT(*) FILTER (WHERE s.consent_form_sent IN ('Sent', 'Sent Digitally')) as consent_form_sent_total,
    COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent') as consent_form_sent_physical,
    COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally') as consent_form_sent_digital,
    COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed') as registration_confirmed,
    COUNT(*) FILTER (WHERE s.registration_status = 'In Progress') as registration_in_progress,
    COUNT(*) FILTER (WHERE s.name_list_status = 'Received') as name_list_received,
    COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded') as name_list_uploaded,
    COUNT(*) FILTER (WHERE s.payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE s.result_status = 'Sent') as result_sent,
    COALESCE((
      SELECT COUNT(*) 
      FROM public.student_registrations sr 
      JOIN public.schools sch ON sr.school_id = sch.id
      WHERE sch.current_project_id = p_project_id
    ), 0) as total_registrations
  FROM public.schools s
  WHERE s.current_project_id = p_project_id;
$$;

-- Now fix the specific school that's missing project_id by assigning it to the current active project
UPDATE public.schools 
SET current_project_id = (
  SELECT id FROM public.olympiad_projects 
  WHERE is_active = true 
  LIMIT 1
)
WHERE current_project_id IS NULL;