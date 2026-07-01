-- Add brochure delivery status enum
CREATE TYPE public.brochure_delivery_status AS ENUM (
  'Physical Only',
  'Digital Sent', 
  'Both Physical & Digital'
);

-- Add brochure delivery status column to schools
ALTER TABLE public.schools 
ADD COLUMN brochure_delivery_status public.brochure_delivery_status DEFAULT 'Physical Only';

-- Drop existing dashboard metrics function
DROP FUNCTION public.get_dashboard_metrics();

-- Recreate dashboard metrics function with brochure delivery counts
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
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
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  brochure_physical_only bigint,
  brochure_digital_sent bigint,
  brochure_both_physical_digital bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Physical Only') as brochure_physical_only,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Digital Sent') as brochure_digital_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital
  FROM public.schools;
$function$;