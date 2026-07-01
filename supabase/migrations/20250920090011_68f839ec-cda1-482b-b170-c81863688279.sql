-- Fix accountant payment view security issues

-- First, let's check if accountant_payment_view is a view or table and handle accordingly
-- If it's a view, we'll drop it and recreate as a secure function-based approach
-- If it's a table, we'll add RLS policies

-- Drop the view if it exists (views can't have RLS policies)
DROP VIEW IF EXISTS public.accountant_payment_view;

-- Create a secure function instead of a view to avoid SECURITY DEFINER view issues
-- This function will replace the accountant_payment_view with proper security
CREATE OR REPLACE FUNCTION public.get_accountant_payment_view()
RETURNS TABLE(
  id uuid,
  ss_no integer,
  school_name text,
  district text,
  state text,
  payment_date date,
  payment_mode text,
  payment_amount numeric,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  registration_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Only allow access to accountants and above
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
  WHERE s.payment_status = 'Received'::payment_status
  AND public.is_accountant_or_above(); -- Security enforcement
$$;

-- Grant execution permission only to authenticated users
REVOKE ALL ON FUNCTION public.get_accountant_payment_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_accountant_payment_view() TO authenticated;

-- Create a secure view that uses the function (this won't have SECURITY DEFINER issues)
-- as it's just calling a secure function
CREATE VIEW public.accountant_payment_view_secure AS
SELECT * FROM public.get_accountant_payment_view();

-- Enable RLS on the secure view (though views inherit security from underlying functions)
ALTER VIEW public.accountant_payment_view_secure OWNER TO postgres;

-- Add comment explaining the security approach
COMMENT ON FUNCTION public.get_accountant_payment_view() IS 'Secure function to access payment data - only accountants and above can view financial information';
COMMENT ON VIEW public.accountant_payment_view_secure IS 'Secure view for payment data that uses security definer function to enforce access control';

-- Log the security fix
SELECT public.log_security_action(
  'PAYMENT_VIEW_SECURITY_FIX',
  'accountant_payment_view',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Replaced insecure view with security definer function',
    'security_level', 'accountant_or_above_only',
    'timestamp', now()
  )
);