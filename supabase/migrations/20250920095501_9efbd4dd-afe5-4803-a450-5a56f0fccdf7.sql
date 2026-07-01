-- Update the get_dashboard_metrics_by_date function to include name_list_uploaded
DROP FUNCTION IF EXISTS public.get_dashboard_metrics_by_date(date);

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_date(target_date date)
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
  name_list_received bigint,
  name_list_uploaded bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  communications_count bigint,
  follow_ups_created bigint,
  follow_ups_completed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH date_metrics AS (
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
      COUNT(*) FILTER (WHERE name_list_status = 'Received') as name_list_received,
      COUNT(*) FILTER (WHERE name_list_status = 'Uploaded') as name_list_uploaded,
      COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
      COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
      COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
      COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent
    FROM public.schools
    WHERE DATE(updated_at) = target_date OR DATE(created_at) = target_date
  ),
  activity_metrics AS (
    SELECT 
      COALESCE((SELECT COUNT(*) FROM communications WHERE DATE(created_at) = target_date), 0) as communications_count,
      COALESCE((SELECT COUNT(*) FROM follow_ups WHERE DATE(created_at) = target_date), 0) as follow_ups_created,
      COALESCE((SELECT COUNT(*) FROM follow_ups WHERE DATE(updated_at) = target_date AND status = 'completed'), 0) as follow_ups_completed
  )
  SELECT 
    dm.*,
    am.communications_count,
    am.follow_ups_created,
    am.follow_ups_completed
  FROM date_metrics dm, activity_metrics am;
$function$;