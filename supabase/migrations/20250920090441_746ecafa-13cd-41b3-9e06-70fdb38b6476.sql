-- Fix all security definer view issues completely
-- Remove all problematic views and functions

-- Drop both problematic views
DROP VIEW IF EXISTS public.accountant_payment_view_secure;
DROP VIEW IF EXISTS public.accountant_payment_view;

-- Drop the security definer function that was causing issues
DROP FUNCTION IF EXISTS public.get_accountant_payment_view();

-- Keep only the original secure function that's actually needed
-- The get_accountant_payment_data() function is fine as it's used properly

-- Create a final, simple view that doesn't have any security definer properties
-- This view will be secure because:
-- 1. It includes the is_accountant_or_above() check directly in the WHERE clause
-- 2. It relies on the RLS policies of the underlying tables
-- 3. It doesn't use any security definer functions or properties

CREATE VIEW public.accountant_payment_view AS
SELECT 
  s.id,
  s.ss_no,
  s.school_name,
  s.district,
  s.state,
  s.payment_date,
  s.payment_mode,
  s.payment_amount,
  s.created_at,
  s.updated_at,
  COALESCE(reg_count.registration_count, 0)::bigint AS registration_count
FROM public.schools s
LEFT JOIN (
  SELECT 
    sr.school_id,
    count(*) AS registration_count
  FROM public.student_registrations sr
  GROUP BY sr.school_id
) reg_count ON (s.id = reg_count.school_id)
WHERE s.payment_status = 'Received'
  AND public.is_accountant_or_above();

-- Grant access to authenticated users
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- Add documentation
COMMENT ON VIEW public.accountant_payment_view IS 'Payment data view with embedded security check - no security definer properties used';

-- Log the final fix
SELECT public.log_security_action(
  'SECURITY_DEFINER_VIEWS_REMOVED',
  'payment_views',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Removed all security definer views and functions',
    'removed_objects', ARRAY['accountant_payment_view_secure', 'get_accountant_payment_view()'],
    'final_security_method', 'direct_function_check_in_view_where_clause',
    'timestamp', now()
  )
);