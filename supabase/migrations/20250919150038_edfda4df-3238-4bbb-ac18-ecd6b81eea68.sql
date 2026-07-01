-- Add RLS policy for accountants to access schools for payment data
CREATE POLICY "Accountants can view schools with payment data" 
ON public.schools 
FOR SELECT 
TO authenticated
USING (
  is_accountant_or_above() AND 
  payment_status = 'Received'
);