-- Fix accountant dashboard security by updating the view and ensuring proper access

-- Create a secure version of the accountant payment view that respects user permissions
CREATE OR REPLACE VIEW public.accountant_payment_view AS
SELECT 
  s.ss_no,
  s.id,
  s.state,
  s.payment_mode,
  COALESCE(reg_count.registration_count, 0) as registration_count,
  s.school_name,
  s.district,
  s.updated_at,
  s.created_at,
  s.payment_amount,
  s.payment_date
FROM public.schools s
LEFT JOIN (
  SELECT 
    sr.school_id,
    COUNT(*) as registration_count
  FROM public.student_registrations sr
  GROUP BY sr.school_id
) reg_count ON s.id = reg_count.school_id
WHERE s.payment_status = 'Received'
  AND is_accountant_or_above(); -- Only show data to accountants and above

-- Update the RPC function to use direct table access with proper security
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
RETURNS TABLE(total_paid_schools bigint, total_registrations bigint, total_payment_amount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Check if user has accountant privileges or above
  SELECT 
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COUNT(*) FROM public.schools WHERE payment_status = 'Received')
    ELSE 0
    END as total_paid_schools,
    CASE WHEN is_accountant_or_above() THEN
      COALESCE((
        SELECT SUM(
          CASE 
            WHEN s.name_list_status = 'Received' THEN (
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
        SELECT SUM(s.payment_amount) 
        FROM public.schools s 
        WHERE s.payment_status = 'Received'
      ), 0)
    ELSE 0
    END as total_payment_amount;
$function$;