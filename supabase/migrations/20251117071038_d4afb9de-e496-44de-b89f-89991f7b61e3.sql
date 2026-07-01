-- Fix get_dashboard_metrics_by_project to count subject-level registrations (total participants)
-- Each subject registration = 1 participant

DROP FUNCTION IF EXISTS get_dashboard_metrics_by_project(uuid);

CREATE OR REPLACE FUNCTION get_dashboard_metrics_by_project(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
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
  registration_pending bigint,
  registration_in_progress bigint,
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE (p_project_id IS NULL OR s.current_project_id = p_project_id)) as total_schools,
    COUNT(*) FILTER (WHERE s.courier_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as courier_sent,
    COUNT(*) FILTER (WHERE s.courier_status = 'Returned' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as courier_returned,
    COUNT(*) FILTER (WHERE s.contacted = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as contacted_yes,
    COUNT(*) FILTER (WHERE s.contacted = 'No' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as contacted_no,
    COUNT(*) FILTER (WHERE s.registration_interest = 'Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as registration_interested,
    COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as registration_not_interested,
    COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as consent_requested,
    COUNT(*) FILTER (WHERE (s.consent_form_sent = 'Sent' OR s.consent_form_sent = 'Sent Digitally') AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as consent_form_sent_total,
    COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as consent_form_sent_physical,
    COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as consent_form_sent_digital,
    COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as registration_confirmed,
    COUNT(*) FILTER (WHERE s.registration_status = 'Pending' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as registration_pending,
    COUNT(*) FILTER (WHERE s.registration_status = 'In Progress' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as registration_in_progress,
    COUNT(*) FILTER (WHERE s.name_list_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as name_list_received,
    COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as name_list_uploaded,
    COUNT(*) FILTER (WHERE s.payment_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as payment_received,
    COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as question_paper_sent,
    COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as answer_sheet_received,
    COUNT(*) FILTER (WHERE s.result_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as result_sent,
    COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as brochure_physical_only,
    COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as brochure_digital_sent,
    COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)) as brochure_both_physical_digital,
    (
      SELECT COUNT(*)
      FROM student_subjects ss
      JOIN student_registrations sr ON ss.registration_id = sr.id
      WHERE (p_project_id IS NULL OR sr.project_id = p_project_id)
    ) as total_registrations
  FROM schools s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;