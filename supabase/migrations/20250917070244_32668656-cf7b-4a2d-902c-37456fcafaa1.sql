-- First, let's see which project most schools are using for registrations
-- and fix the accountant dashboard metrics function

-- Update the function to count ALL registrations for paid schools, not just current project
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
 RETURNS TABLE(total_paid_schools bigint, total_registrations bigint, total_payment_amount numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    COUNT(*) as total_paid_schools,
    COALESCE(SUM(
      (SELECT COUNT(*) 
       FROM student_registrations sr 
       WHERE sr.school_id = s.id)
    ), 0) as total_registrations,
    COALESCE(SUM(s.payment_amount), 0) as total_payment_amount
  FROM schools s
  WHERE s.payment_status = 'Received';
$function$;

-- Also create or update the accountant_payment_view to show correct registration counts
CREATE OR REPLACE VIEW accountant_payment_view AS
SELECT 
  s.id,
  s.ss_no,
  s.school_name,
  s.district,
  s.state,
  s.payment_date,
  s.payment_amount,
  s.payment_mode,
  s.created_at,
  s.updated_at,
  COALESCE((
    SELECT COUNT(*) 
    FROM student_registrations sr 
    WHERE sr.school_id = s.id
  ), 0) as registration_count
FROM schools s
WHERE s.payment_status = 'Received'
ORDER BY s.payment_date DESC, s.ss_no;