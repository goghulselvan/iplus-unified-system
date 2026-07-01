-- Update the payment status logic to handle edge cases properly
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  total_transactions NUMERIC := 0;
  registration_count INTEGER := 0;
  school_data RECORD;
  calculated_expected NUMERIC;
  calculated_outstanding NUMERIC;
  new_payment_status payment_status;
BEGIN
  -- Get school data with rates
  SELECT s.per_entry_rate, s.concession_per_entry, s.effective_rate_per_entry 
  INTO school_data
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Calculate total payments received
  SELECT COALESCE(SUM(payment_amount), 0) INTO total_transactions
  FROM public.payment_transactions
  WHERE school_id = p_school_id;
  
  -- Count student registrations
  SELECT COUNT(*) INTO registration_count
  FROM public.student_registrations
  WHERE school_id = p_school_id;
  
  -- Calculate expected amount using effective rate
  calculated_expected := registration_count * COALESCE(school_data.effective_rate_per_entry, school_data.per_entry_rate, 150);
  
  -- Calculate outstanding balance
  calculated_outstanding := calculated_expected - total_transactions;
  
  -- Determine payment status based on the workflow logic
  IF total_transactions = 0 THEN
    new_payment_status := 'Pending'::payment_status;
  ELSIF total_transactions > 0 AND calculated_outstanding > 0 THEN
    -- Only "Partial" if there's positive outstanding balance (money still owed)
    new_payment_status := 'Partial'::payment_status;
  ELSIF total_transactions > 0 AND calculated_outstanding <= 0 THEN
    -- "Received" if payment covers expected amount or no registrations yet
    new_payment_status := 'Received'::payment_status;
  ELSE
    new_payment_status := 'Pending'::payment_status;
  END IF;
  
  -- Update school with all calculated values
  UPDATE public.schools 
  SET 
    payment_received = total_transactions,
    expected_amount = calculated_expected,
    payment_status = new_payment_status,
    updated_at = now()
  WHERE id = p_school_id;
END;
$function$;