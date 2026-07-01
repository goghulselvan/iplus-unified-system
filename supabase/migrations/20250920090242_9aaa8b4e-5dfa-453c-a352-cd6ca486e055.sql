-- Fix payment view security using PostgreSQL 15+ security_invoker approach
-- This avoids security definer issues while maintaining proper access control

-- Drop the materialized view since we can't use RLS on it
DROP MATERIALIZED VIEW IF EXISTS public.accountant_payment_summary;

-- Drop any existing view or table
DROP VIEW IF EXISTS public.accountant_payment_view;
DROP TABLE IF EXISTS public.accountant_payment_view;

-- Create a security invoker view that respects the underlying table's RLS policies
-- This works in PostgreSQL 15+ and avoids the security definer view warning
CREATE OR REPLACE VIEW public.accountant_payment_view
WITH (security_invoker = on) AS
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
  AND public.is_accountant_or_above(); -- Direct security check in the view

-- Grant access to authenticated users
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- Add comment explaining the security approach
COMMENT ON VIEW public.accountant_payment_view IS 'Security invoker view for payment data - respects underlying RLS and includes accountant access check';

-- Ensure the schools table has proper policies for this to work
-- The view will inherit security from the schools table RLS policies

-- Log the final security implementation
SELECT public.log_security_action(
  'PAYMENT_VIEW_SECURITY_FINAL',
  'accountant_payment_view',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Created security invoker view with embedded access control',
    'security_method', 'security_invoker_view_with_function_check',
    'access_control', 'is_accountant_or_above() function check',
    'timestamp', now()
  )
);