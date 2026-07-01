-- Fix the security definer view issue by recreating as security invoker view

-- Drop the existing view
DROP VIEW IF EXISTS public.accountant_payment_view;

-- Create the view as SECURITY INVOKER to run with the privileges of the current user
-- This ensures RLS policies are properly enforced
CREATE VIEW public.accountant_payment_view
WITH (security_invoker = true) AS
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
WHERE s.payment_status = 'Received';

-- The security is now properly handled by the existing RLS policies on the schools table
-- Accountants will only see data they have permission to access through the "Accountants can view schools with payment data" policy