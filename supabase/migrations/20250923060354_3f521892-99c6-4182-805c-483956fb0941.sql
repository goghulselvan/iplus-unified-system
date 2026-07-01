-- Update the recalculate_school_payment_totals function to also calculate and set payment status
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_received NUMERIC := 0;
  total_expected NUMERIC := 0;
  total_outstanding NUMERIC := 0;
  new_payment_status payment_status;
BEGIN
  -- Get total payments received for this school
  SELECT COALESCE(SUM(payment_amount), 0) INTO total_received
  FROM public.payment_transactions
  WHERE school_id = p_school_id;
  
  -- Get expected amount (should already be calculated, but ensure it's current)
  PERFORM public.calculate_expected_amount(p_school_id);
  
  -- Get the updated expected amount
  SELECT COALESCE(expected_amount, 0) INTO total_expected
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Calculate outstanding balance
  total_outstanding := GREATEST(total_expected - total_received, 0);
  
  -- Determine payment status based on amounts
  IF total_received = 0 THEN
    new_payment_status := 'Pending';
  ELSIF total_outstanding > 0 THEN
    new_payment_status := 'Partial';
  ELSE
    new_payment_status := 'Received';
  END IF;
  
  -- Update school with calculated totals and status
  UPDATE public.schools
  SET 
    payment_received = total_received,
    outstanding_balance = total_outstanding,
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
      'total_received', total_received,
      'total_expected', total_expected,
      'outstanding_balance', total_outstanding,
      'payment_status', new_payment_status
    )
  );
END;
$function$;