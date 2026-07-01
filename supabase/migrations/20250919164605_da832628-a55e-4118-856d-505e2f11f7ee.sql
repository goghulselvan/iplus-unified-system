-- Fix RLS policies for accountant dashboard access
-- Enable RLS on accountant_payment_view and add proper policies

-- Enable RLS on the accountant payment view
ALTER TABLE public.accountant_payment_view ENABLE ROW LEVEL SECURITY;

-- Create policy to allow accountants and above to view payment data
CREATE POLICY "Accountants can view payment records" 
ON public.accountant_payment_view 
FOR SELECT 
USING (is_accountant_or_above());

-- Ensure the RPC function has proper security
-- Update the get_accountant_dashboard_metrics function to be accessible by accountants
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
RETURNS TABLE(total_paid_schools bigint, total_registrations bigint, total_payment_amount numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only allow accountants and above to access this function
  SELECT 
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COUNT(*) FROM public.accountant_payment_view)
    ELSE 0
    END as total_paid_schools,
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COALESCE(SUM(registration_count), 0) FROM public.accountant_payment_view)
    ELSE 0
    END as total_registrations,
    CASE WHEN is_accountant_or_above() THEN
      (SELECT COALESCE(SUM(payment_amount), 0) FROM public.accountant_payment_view)
    ELSE 0
    END as total_payment_amount;
$function$;