-- Drop and recreate the function to update return type
DROP FUNCTION IF EXISTS public.get_dashboard_metrics_optimized(uuid);

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_optimized(p_project_id uuid DEFAULT NULL::uuid)
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
  registration_pending bigint,
  name_list_received bigint,
  name_list_uploaded bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  brochure_physical_only bigint,
  brochure_digital_sent bigint,
  brochure_both_physical_digital bigint,
  total_registrations bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  active_project_id uuid;
BEGIN
  -- Get active project if not provided
  IF p_project_id IS NULL THEN
    SELECT id INTO active_project_id
    FROM public.olympiad_projects
    WHERE is_active = true
    LIMIT 1;
  ELSE
    active_project_id := p_project_id;
  END IF;

  -- If we have a project, use project-specific workflow data
  IF active_project_id IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      COUNT(DISTINCT spw.school_id) as total_schools,
      COUNT(*) FILTER (WHERE spw.courier_status = 'Sent') as courier_sent,
      COUNT(*) FILTER (WHERE spw.courier_status = 'Returned') as courier_returned,
      COUNT(*) FILTER (WHERE spw.contacted = 'Yes') as contacted_yes,
      COUNT(*) FILTER (WHERE spw.contacted = 'No') as contacted_no,
      COUNT(*) FILTER (WHERE spw.registration_interest = 'Interested') as registration_interested,
      COUNT(*) FILTER (WHERE spw.registration_interest = 'Not Interested') as registration_not_interested,
      COUNT(*) FILTER (WHERE spw.consent_form_requested = 'Yes') as consent_requested,
      COUNT(*) FILTER (WHERE spw.consent_form_sent IN ('Sent', 'Sent Digitally')) as consent_form_sent_total,
      COUNT(*) FILTER (WHERE spw.consent_form_sent = 'Sent') as consent_form_sent_physical,
      COUNT(*) FILTER (WHERE spw.consent_form_sent = 'Sent Digitally') as consent_form_sent_digital,
      COUNT(*) FILTER (WHERE spw.registration_status = 'Confirmed') as registration_confirmed,
      COUNT(*) FILTER (WHERE spw.registration_status = 'In Progress') as registration_in_progress,
      COUNT(*) FILTER (WHERE spw.registration_status = 'Pending') as registration_pending,
      COUNT(*) FILTER (WHERE spw.name_list_status = 'Received') as name_list_received,
      COUNT(*) FILTER (WHERE spw.name_list_status = 'Uploaded') as name_list_uploaded,
      COUNT(*) FILTER (WHERE spw.payment_status = 'Received') as payment_received,
      COUNT(*) FILTER (WHERE spw.question_paper_sent = 'Sent') as question_paper_sent,
      COUNT(*) FILTER (WHERE spw.answer_sheet_status = 'Received') as answer_sheet_received,
      COUNT(*) FILTER (WHERE spw.result_status = 'Sent') as result_sent,
      COUNT(*) FILTER (WHERE spw.brochure_delivery_status = 'Physical Only') as brochure_physical_only,
      COUNT(*) FILTER (WHERE spw.brochure_delivery_status = 'Digital Sent') as brochure_digital_sent,
      COUNT(*) FILTER (WHERE spw.brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital,
      (
        SELECT COUNT(*) 
        FROM public.student_registrations sr
        WHERE sr.project_id = active_project_id
        AND sr.registration_number_generated NOT LIKE '%RETIRED%'
      ) as total_registrations
    FROM public.school_project_workflow spw
    WHERE spw.project_id = active_project_id;
  ELSE
    -- Fallback to counting from schools table if no project
    RETURN QUERY
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
      COUNT(*) FILTER (WHERE s.registration_status = 'Pending') as registration_pending,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received') as name_list_received,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded') as name_list_uploaded,
      COUNT(*) FILTER (WHERE s.payment_status = 'Received') as payment_received,
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent') as question_paper_sent,
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received') as answer_sheet_received,
      COUNT(*) FILTER (WHERE s.result_status = 'Sent') as result_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only') as brochure_physical_only,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent') as brochure_digital_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital,
      0::bigint as total_registrations
    FROM public.schools s;
  END IF;
END;
$$;