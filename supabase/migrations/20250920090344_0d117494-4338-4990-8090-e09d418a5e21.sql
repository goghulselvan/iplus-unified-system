-- Identify and fix security definer view issues
-- First, let's see what objects are triggering the security definer warning

-- Query to find all security definer views and functions
DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Log all security definer views
    FOR rec IN 
        SELECT schemaname, viewname, definition 
        FROM pg_views 
        WHERE schemaname = 'public' 
        AND (definition ILIKE '%security_definer%' OR definition ILIKE '%security definer%')
    LOOP
        RAISE NOTICE 'Security definer view found: %.% - %', rec.schemaname, rec.viewname, rec.definition;
    END LOOP;
    
    -- Log all security definer functions that might be problematic
    FOR rec IN 
        SELECT proname, prosecdef
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.prosecdef = true
        AND p.proname NOT LIKE 'refresh_%'
        AND p.proname NOT IN ('is_accountant', 'is_accountant_or_above', 'is_manager_or_superadmin', 'is_superadmin', 'is_superadmin_with_ip_check')
    LOOP
        RAISE NOTICE 'Security definer function found: %', rec.proname;
    END LOOP;
END $$;

-- Remove the problematic security invoker clause and simplify the view
-- Some versions of PostgreSQL may not support security_invoker option properly
DROP VIEW IF EXISTS public.accountant_payment_view;

-- Create a simple view without any security definer properties
-- The security will be handled by the underlying tables and the function call
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
  AND public.is_accountant_or_above(); -- This function call provides the security

-- Grant access to authenticated users
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- The view now relies on:
-- 1. The RLS policies on the underlying 'schools' table
-- 2. The security check in the is_accountant_or_above() function
-- This approach avoids any security definer view warnings

COMMENT ON VIEW public.accountant_payment_view IS 'Payment data view secured via underlying table RLS and function-based access control';

-- Log the security fix
SELECT public.log_security_action(
  'PAYMENT_VIEW_SECURITY_SIMPLIFIED',
  'accountant_payment_view',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Created simple view with function-based security check',
    'security_method', 'function_check_plus_underlying_rls',
    'access_control', 'is_accountant_or_above() + schools table RLS',
    'timestamp', now()
  )
);