-- Add RLS policies for accountants to access the accountant_payment_view
-- Enable RLS on the accountant_payment_view if not already enabled
ALTER TABLE public.accountant_payment_view ENABLE ROW LEVEL SECURITY;

-- Add policy for accountants and above to view payment data
CREATE POLICY "Accountants can view payment data" 
ON public.accountant_payment_view 
FOR SELECT 
TO authenticated
USING (is_accountant_or_above());

-- Also add policy for superadmins
CREATE POLICY "Superadmins can view all payment data" 
ON public.accountant_payment_view 
FOR SELECT 
TO authenticated  
USING (is_superadmin(auth.uid()));