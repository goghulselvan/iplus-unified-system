-- Fix the get_dashboard_metrics function to include registration_in_progress count
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  total_schools BIGINT,
  courier_sent BIGINT,
  courier_returned BIGINT,
  contacted_yes BIGINT,
  contacted_no BIGINT,
  registration_interested BIGINT,
  registration_not_interested BIGINT,
  consent_requested BIGINT,
  consent_form_sent_total BIGINT,
  consent_form_sent_physical BIGINT,
  consent_form_sent_digital BIGINT,
  registration_confirmed BIGINT,
  registration_in_progress BIGINT,
  name_list_received BIGINT,
  payment_received BIGINT,
  question_paper_sent BIGINT,
  answer_sheet_received BIGINT,
  result_sent BIGINT,
  brochure_physical_only BIGINT,
  brochure_digital_sent BIGINT,
  brochure_both_physical_digital BIGINT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_schools,
    COUNT(*) FILTER (WHERE courier_status = 'Sent') as courier_sent,
    COUNT(*) FILTER (WHERE courier_status = 'Returned') as courier_returned,
    COUNT(*) FILTER (WHERE contacted = 'Yes') as contacted_yes,
    COUNT(*) FILTER (WHERE contacted = 'No') as contacted_no,
    COUNT(*) FILTER (WHERE registration_interest = 'Interested') as registration_interested,
    COUNT(*) FILTER (WHERE registration_interest = 'Not Interested') as registration_not_interested,
    COUNT(*) FILTER (WHERE consent_form_requested = 'Yes') as consent_requested,
    COUNT(*) FILTER (WHERE consent_form_sent IN ('Sent', 'Sent Digitally')) as consent_form_sent_total,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent') as consent_form_sent_physical,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent Digitally') as consent_form_sent_digital,
    COUNT(*) FILTER (WHERE registration_status = 'Confirmed') as registration_confirmed,
    COUNT(*) FILTER (WHERE registration_status = 'In Progress') as registration_in_progress,
    COUNT(*) FILTER (WHERE name_list_status = 'Received') as name_list_received,
    COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Physical Only') as brochure_physical_only,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Digital Only') as brochure_digital_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital
  FROM schools;
END;
$$;