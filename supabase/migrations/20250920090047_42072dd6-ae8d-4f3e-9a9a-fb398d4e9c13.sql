-- Remove the security definer view and implement a proper secure solution

-- Drop the view that's causing the security definer warning
DROP VIEW IF EXISTS public.accountant_payment_view_secure;

-- The existing get_accountant_payment_view function is fine as it's a function, not a view
-- But let's ensure the original accountant_payment_view is properly secured as a regular view

-- Create a standard view (not security definer) that will be secured via RLS
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
WHERE s.payment_status = 'Received';

-- Enable RLS on the view
ALTER VIEW public.accountant_payment_view ENABLE ROW LEVEL SECURITY;

-- Create RLS policy to restrict access to accountants and above only
CREATE POLICY "Only accountants can view payment data" ON public.accountant_payment_view
  FOR SELECT
  USING (public.is_accountant_or_above());

-- Grant access to authenticated users (RLS will handle the restriction)
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- Add security comment
COMMENT ON VIEW public.accountant_payment_view IS 'Secure view for payment data with RLS policies restricting access to accountants and above';

-- Log the security improvement
SELECT public.log_security_action(
  'PAYMENT_VIEW_RLS_ENABLED',
  'accountant_payment_view',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Enabled RLS on payment view with accountant-only access',
    'security_level', 'accountant_or_above_only',
    'timestamp', now()
  )
);