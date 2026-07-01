CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_transactions NUMERIC := 0;
  school_data RECORD;
  calculated_expected NUMERIC;
  calculated_effective_rate NUMERIC;
  new_payment_status payment_status;
BEGIN
  -- Get school data with participant count and rates
  SELECT s.total_participants, s.per_entry_rate, s.concession_per_entry, s.effective_rate_per_entry, s.payment_received
  INTO school_data
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Calculate total payments received from transactions
  SELECT COALESCE(SUM(payment_amount), 0) INTO total_transactions
  FROM public.payment_transactions
  WHERE school_id = p_school_id;
  
  -- Calculate effective rate for calculations (read from generated column or compute)
  calculated_effective_rate := COALESCE(school_data.effective_rate_per_entry, 
    COALESCE(school_data.per_entry_rate, 150) - COALESCE(school_data.concession_per_entry, 0));
  
  -- Calculate expected amount using total_participants and effective rate
  calculated_expected := COALESCE(school_data.total_participants, 0) * calculated_effective_rate;
  
  -- Determine payment status based on calculated values
  -- outstanding_balance will be auto-calculated as (expected_amount - payment_received)
  IF total_transactions = 0 THEN
    new_payment_status := 'Pending'::payment_status;
  ELSIF total_transactions > 0 AND (calculated_expected - total_transactions) > 0 THEN
    new_payment_status := 'Partial'::payment_status;
  ELSIF total_transactions >= calculated_expected AND calculated_expected > 0 THEN
    new_payment_status := 'Received'::payment_status;
  ELSIF total_transactions > 0 AND calculated_expected = 0 THEN
    new_payment_status := 'Received'::payment_status;
  ELSE
    new_payment_status := 'Pending'::payment_status;
  END IF;
  
  -- Update school - only set expected_amount and payment_received
  -- outstanding_balance is auto-calculated: (expected_amount - payment_received)
  -- effective_rate_per_entry is auto-calculated: (per_entry_rate - concession_per_entry)
  UPDATE public.schools 
  SET 
    expected_amount = calculated_expected,
    payment_received = total_transactions,
    payment_status = new_payment_status,
    updated_at = now()
  WHERE id = p_school_id;
END;
$function$;