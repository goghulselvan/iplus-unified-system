-- Create a new function that respects regional access for dashboard metrics
CREATE OR REPLACE FUNCTION get_dashboard_metrics_by_project_with_access(p_project_id uuid DEFAULT NULL)
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
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_data_access_level text;
  v_assigned_districts text[];
  v_is_superadmin boolean;
BEGIN
  -- Get user's access level and assigned districts
  SELECT 
    p.data_access_level,
    p.assigned_districts,
    (p.role = 'superadmin')
  INTO v_data_access_level, v_assigned_districts, v_is_superadmin
  FROM profiles p
  WHERE p.user_id = v_user_id;

  -- Superadmins and full access users see everything
  IF v_is_superadmin OR v_data_access_level = 'full' THEN
    RETURN QUERY
    SELECT
      COUNT(*) FILTER (WHERE (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.courier_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.courier_status = 'Returned' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.contacted = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.contacted = 'No' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_interest = 'Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE (s.consent_form_sent = 'Sent' OR s.consent_form_sent = 'Sent Digitally') AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'Pending' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'In Progress' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.payment_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.result_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COALESCE(SUM(s.total_participants) FILTER (WHERE p_project_id IS NULL OR s.current_project_id = p_project_id), 0)
    FROM schools s;
  
  -- Regional access users see only their assigned districts
  ELSIF v_data_access_level = 'regional' AND v_assigned_districts IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*) FILTER (WHERE (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.courier_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.courier_status = 'Returned' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.contacted = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.contacted = 'No' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_interest = 'Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE (s.consent_form_sent = 'Sent' OR s.consent_form_sent = 'Sent Digitally') AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'Pending' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.registration_status = 'In Progress' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.payment_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.result_status = 'Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital' AND (p_project_id IS NULL OR s.current_project_id = p_project_id)),
      COALESCE(SUM(s.total_participants) FILTER (WHERE p_project_id IS NULL OR s.current_project_id = p_project_id), 0)
    FROM schools s
    WHERE s.district = ANY(v_assigned_districts) OR 'ALL' = ANY(v_assigned_districts);
  
  -- Limited access users see nothing (return zeros)
  ELSE
    RETURN QUERY
    SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 
           0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 
           0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 
           0::bigint, 0::bigint, 0::bigint;
  END IF;
END;
$$;