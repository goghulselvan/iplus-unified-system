
-- Align total_registrations with "participation" (schools.current_project_id)
-- and exclude any registration marked as RETIRED anywhere in registration_number_generated.

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project_with_access(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  total_schools bigint,
  contacted_yes bigint,
  contacted_no bigint,
  registration_interested bigint,
  registration_not_interested bigint,
  registration_in_progress bigint,
  registration_pending bigint,
  registration_confirmed bigint,
  consent_requested bigint,
  consent_form_sent_total bigint,
  consent_form_sent_physical bigint,
  consent_form_sent_digital bigint,
  courier_sent bigint,
  courier_returned bigint,
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
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH accessible_schools AS (
    SELECT s.id AS school_id, 
           s.contacted AS s_contacted, 
           s.registration_interest AS s_registration_interest, 
           s.registration_status AS s_registration_status,
           s.consent_form_requested AS s_consent_form_requested, 
           s.consent_form_sent AS s_consent_form_sent, 
           s.courier_status AS s_courier_status,
           s.name_list_status AS s_name_list_status, 
           s.payment_status AS s_payment_status, 
           s.question_paper_sent AS s_question_paper_sent,
           s.answer_sheet_status AS s_answer_sheet_status, 
           s.result_status AS s_result_status, 
           s.brochure_delivery_status AS s_brochure_delivery_status,
           s.current_project_id AS s_current_project_id
    FROM schools s
    WHERE can_access_school_data(s.district)
      AND (p_project_id IS NULL OR s.current_project_id = p_project_id)
  ),
  registration_count AS (
    -- Count ACTIVE participations only for schools in the selected project
    -- (matches how schools.total_participants is derived)
    SELECT COUNT(ss.id) as cnt
    FROM student_subjects ss
    INNER JOIN student_registrations sr ON ss.registration_id = sr.id
    INNER JOIN accessible_schools a ON a.school_id = sr.school_id
    WHERE (p_project_id IS NULL OR sr.project_id = p_project_id)
      AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%'
  )
  SELECT
    COUNT(*)::bigint AS total_schools,
    COUNT(*) FILTER (WHERE a.s_contacted = 'Yes')::bigint AS contacted_yes,
    COUNT(*) FILTER (WHERE a.s_contacted = 'No')::bigint AS contacted_no,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Interested')::bigint AS registration_interested,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Not Interested')::bigint AS registration_not_interested,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'In Progress')::bigint AS registration_in_progress,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Pending')::bigint AS registration_pending,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Confirmed')::bigint AS registration_confirmed,
    COUNT(*) FILTER (WHERE a.s_consent_form_requested = 'Yes')::bigint AS consent_requested,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent IN ('Physical', 'Digital', 'Both'))::bigint AS consent_form_sent_total,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Physical')::bigint AS consent_form_sent_physical,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Digital')::bigint AS consent_form_sent_digital,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Sent')::bigint AS courier_sent,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Returned')::bigint AS courier_returned,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Received')::bigint AS name_list_received,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Uploaded')::bigint AS name_list_uploaded,
    COUNT(*) FILTER (WHERE a.s_payment_status = 'Received')::bigint AS payment_received,
    COUNT(*) FILTER (WHERE a.s_question_paper_sent = 'Sent')::bigint AS question_paper_sent,
    COUNT(*) FILTER (WHERE a.s_answer_sheet_status = 'Received')::bigint AS answer_sheet_received,
    COUNT(*) FILTER (WHERE a.s_result_status = 'Sent')::bigint AS result_sent,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Physical Only')::bigint AS brochure_physical_only,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Digital Sent')::bigint AS brochure_digital_sent,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Both Physical & Digital')::bigint AS brochure_both_physical_digital,
    (SELECT cnt FROM registration_count)::bigint AS total_registrations
  FROM accessible_schools a;
END;
$$;
