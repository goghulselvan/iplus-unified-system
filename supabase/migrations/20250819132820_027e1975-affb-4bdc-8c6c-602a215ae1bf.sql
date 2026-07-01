-- Add indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_schools_ss_no ON public.schools(ss_no);
CREATE INDEX IF NOT EXISTS idx_schools_school_name ON public.schools USING gin(school_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_schools_district ON public.schools(district);
CREATE INDEX IF NOT EXISTS idx_schools_board ON public.schools(board);
CREATE INDEX IF NOT EXISTS idx_schools_contact_person_name ON public.schools USING gin(contact_person_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_schools_mobile1 ON public.schools(mobile1);
CREATE INDEX IF NOT EXISTS idx_schools_mobile2 ON public.schools(mobile2);
CREATE INDEX IF NOT EXISTS idx_schools_email ON public.schools(email);
CREATE INDEX IF NOT EXISTS idx_schools_created_at ON public.schools(created_at);

-- Enable trigram extension for better text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create function for dashboard metrics (server-side aggregation)
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
RETURNS TABLE (
  total_schools bigint,
  courier_sent bigint,
  courier_returned bigint,
  contacted_yes bigint,
  contacted_no bigint,
  registration_interested bigint,
  registration_not_interested bigint,
  consent_requested bigint,
  registration_confirmed bigint,
  name_list_received bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint
) 
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    COUNT(*) as total_schools,
    COUNT(*) FILTER (WHERE courier_status = 'Sent') as courier_sent,
    COUNT(*) FILTER (WHERE courier_status = 'Returned') as courier_returned,
    COUNT(*) FILTER (WHERE contacted = 'Yes') as contacted_yes,
    COUNT(*) FILTER (WHERE contacted = 'No') as contacted_no,
    COUNT(*) FILTER (WHERE registration_interest = 'Interested') as registration_interested,
    COUNT(*) FILTER (WHERE registration_interest = 'Not Interested') as registration_not_interested,
    COUNT(*) FILTER (WHERE consent_form_requested = 'Yes') as consent_requested,
    COUNT(*) FILTER (WHERE registration_status = 'Confirmed') as registration_confirmed,
    COUNT(*) FILTER (WHERE name_list_status = 'Received') as name_list_received,
    COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent
  FROM public.schools;
$$;