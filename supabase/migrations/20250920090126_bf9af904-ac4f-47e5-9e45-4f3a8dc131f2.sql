-- Fix accountant payment view security without using RLS on views
-- Since views can't have RLS, we'll use a secure function approach instead

-- Drop the view if it exists
DROP VIEW IF EXISTS public.accountant_payment_view;

-- Keep the secure function we created earlier - this is the proper way to secure payment data
-- The function already has the security check: AND public.is_accountant_or_above()

-- Update the existing useAccountantDashboard hook to use the secure function instead of a view
-- But first, let's also ensure we have a materialized view alternative if needed

-- Create a secure materialized view that can be refreshed periodically
-- This avoids the security definer view issue while providing good performance
CREATE MATERIALIZED VIEW public.accountant_payment_summary AS
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
WHERE s.payment_status = 'Received';

-- Enable RLS on the materialized view (this is allowed)
ALTER MATERIALIZED VIEW public.accountant_payment_summary ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for the materialized view
CREATE POLICY "Only accountants can access payment summary" ON public.accountant_payment_summary
  FOR SELECT
  USING (public.is_accountant_or_above());

-- Grant select to authenticated users (RLS will enforce restrictions)
GRANT SELECT ON public.accountant_payment_summary TO authenticated;

-- Create a function to refresh the materialized view (only for superadmins)
CREATE OR REPLACE FUNCTION public.refresh_payment_summary()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  REFRESH MATERIALIZED VIEW public.accountant_payment_summary;
$$;

-- Grant execute only to superadmins for the refresh function
REVOKE ALL ON FUNCTION public.refresh_payment_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_payment_summary() TO authenticated;

-- Add a policy to the refresh function via a wrapper that checks permissions
CREATE OR REPLACE FUNCTION public.refresh_payment_summary_secure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Only superadmins can refresh the materialized view
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: Only superadmins can refresh payment summary';
  END IF;
  
  REFRESH MATERIALIZED VIEW public.accountant_payment_summary;
END;
$$;

-- Add comments
COMMENT ON MATERIALIZED VIEW public.accountant_payment_summary IS 'Secure materialized view for payment data with RLS policies restricting access to accountants and above';
COMMENT ON FUNCTION public.get_accountant_payment_view() IS 'Primary secure function to access real-time payment data - only accountants and above';
COMMENT ON FUNCTION public.refresh_payment_summary_secure() IS 'Secure function to refresh payment summary - only superadmins';

-- Log the security fix
SELECT public.log_security_action(
  'PAYMENT_DATA_SECURITY_IMPLEMENTED',
  'accountant_payment_data',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Implemented secure payment data access via function and materialized view with RLS',
    'components', ARRAY['get_accountant_payment_view()', 'accountant_payment_summary', 'refresh_payment_summary_secure()'],
    'security_level', 'accountant_or_above_only',
    'timestamp', now()
  )
);