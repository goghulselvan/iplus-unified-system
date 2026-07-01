-- Update existing schools payment status based on new workflow logic
UPDATE public.schools 
SET payment_status = CASE 
  WHEN COALESCE(payment_received, 0) = 0 THEN 'Pending'::payment_status
  WHEN COALESCE(payment_received, 0) > 0 AND COALESCE(outstanding_balance, 0) > 0 THEN 'Partial'::payment_status  
  WHEN COALESCE(payment_received, 0) > 0 AND COALESCE(outstanding_balance, 0) <= 0 THEN 'Received'::payment_status
  ELSE payment_status -- Keep existing status if none of the conditions match
END
WHERE payment_status IS NOT NULL;