-- Create enhanced accountant dashboard metrics function
CREATE OR REPLACE FUNCTION public.get_enhanced_accountant_dashboard_metrics()
RETURNS TABLE(
  total_paid_schools bigint, 
  total_registrations bigint, 
  total_payment_amount numeric,
  total_expected_amount numeric,
  total_concessions numeric,
  total_outstanding numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return data if user has accountant privileges or above
  SELECT 
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COUNT(*) FROM public.schools WHERE payment_status = 'Received')
    ELSE 0
    END as total_paid_schools,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(
          CASE 
            WHEN s.name_list_status = 'Uploaded' THEN (
              SELECT COUNT(*) 
              FROM public.student_registrations sr 
              WHERE sr.school_id = s.id
            )
            ELSE 0
          END
        )
        FROM public.schools s
        WHERE s.payment_status = 'Received'
      ), 0)
    ELSE 0
    END as total_registrations,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(s.payment_received) 
        FROM public.schools s 
        WHERE s.payment_status = 'Received'
      ), 0)
    ELSE 0
    END as total_payment_amount,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(s.expected_amount) 
        FROM public.schools s
      ), 0)
    ELSE 0
    END as total_expected_amount,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(
          (SELECT COUNT(*) FROM public.student_registrations sr WHERE sr.school_id = s.id) 
          * s.concession_per_entry
        ) 
        FROM public.schools s 
        WHERE s.concession_per_entry > 0
      ), 0)
    ELSE 0
    END as total_concessions,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(s.outstanding_balance) 
        FROM public.schools s 
        WHERE s.outstanding_balance > 0
      ), 0)
    ELSE 0
    END as total_outstanding;
$function$;