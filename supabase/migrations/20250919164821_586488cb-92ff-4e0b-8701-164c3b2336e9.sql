-- Fix accountant dashboard RLS security by ensuring proper access to underlying data
-- Since we can't enable RLS on views, we need to ensure the underlying data access is secure

-- First, let's update the get_accountant_dashboard_metrics function to properly check permissions
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
RETURNS TABLE(total_paid_schools bigint, total_registrations bigint, total_payment_amount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Check if user has accountant or higher permissions
  SELECT 
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COUNT(*)::bigint FROM schools WHERE payment_status = 'Received')
    ELSE 0::bigint
    END as total_paid_schools,
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COALESCE(SUM(
        CASE 
          WHEN s.name_list_status = 'Received' THEN (
            SELECT COUNT(*) 
            FROM student_registrations sr 
            WHERE sr.school_id = s.id
          )
          ELSE 0
        END
      ), 0)::bigint
      FROM schools s
      WHERE s.payment_status = 'Received')
    ELSE 0::bigint
    END as total_registrations,
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COALESCE(SUM(payment_amount), 0) FROM schools WHERE payment_status = 'Received')
    ELSE 0
    END as total_payment_amount;
$function$;

-- Create a security definer function to get accountant payment data
CREATE OR REPLACE FUNCTION public.get_accountant_payment_data()
RETURNS TABLE(
  id uuid,
  ss_no integer,
  school_name text,
  payment_date date,
  payment_amount numeric,
  payment_mode text,
  district text,
  state text,
  registration_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return data if user is accountant or above
  SELECT 
    s.id,
    s.ss_no,
    s.school_name,
    s.payment_date,
    s.payment_amount,
    s.payment_mode,
    s.district,
    s.state,
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM student_registrations sr
      WHERE sr.school_id = s.id
    ), 0) as registration_count
  FROM schools s
  WHERE s.payment_status = 'Received'
    AND is_accountant_or_above()
  ORDER BY s.payment_date DESC NULLS LAST;
$function$;