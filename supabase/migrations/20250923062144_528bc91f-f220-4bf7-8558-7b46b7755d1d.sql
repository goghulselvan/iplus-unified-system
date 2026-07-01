-- Fix the recalculate_school_payment_totals function to properly handle payment status updates
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
    new_payment_status := 'Partial'::payment_status;
  ELSIF total_transactions > 0 AND calculated_outstanding <= 0 THEN
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
  
  -- Log the recalculation
  PERFORM public.log_security_action(
    'PAYMENT_TOTALS_RECALCULATED',
    'schools',
    p_school_id,
    NULL,
    jsonb_build_object(
      'payment_received', total_transactions,
      'expected_amount', calculated_expected,
      'outstanding_balance', calculated_outstanding,
      'payment_status', new_payment_status,
      'registration_count', registration_count
    )
  );
END;
$function$;

-- Recalculate for the specific school that has the issue
SELECT public.recalculate_school_payment_totals('8b30aaf4-c2e1-4130-a5b3-7a64dc196766');