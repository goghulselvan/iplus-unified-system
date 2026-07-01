-- Fix payment calculation to use total_participants instead of student registrations
-- This makes payment independent from student registration uploads
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  total_transactions NUMERIC := 0;
  school_data RECORD;
  calculated_expected NUMERIC;
  new_payment_status payment_status;
BEGIN
  -- Get school data with participant count and rates
  SELECT s.total_participants, s.per_entry_rate, s.concession_per_entry, s.effective_rate_per_entry 
  INTO school_data
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Calculate total payments received
  SELECT COALESCE(SUM(payment_amount), 0) INTO total_transactions
  FROM public.payment_transactions
  WHERE school_id = p_school_id;
  
  -- Calculate expected amount using total_participants (NOT student registrations)
  -- This is the expected participant count entered manually, independent of name list uploads
  calculated_expected := COALESCE(school_data.total_participants, 0) * COALESCE(school_data.effective_rate_per_entry, school_data.per_entry_rate, 150);
  
  -- Determine payment status based on payments vs expected amount
  IF total_transactions = 0 THEN
    new_payment_status := 'Pending'::payment_status;
  ELSIF total_transactions > 0 AND (calculated_expected - total_transactions) > 0 THEN
    -- Partial payment: money received but still owe more
    new_payment_status := 'Partial'::payment_status;
  ELSIF total_transactions >= calculated_expected AND calculated_expected > 0 THEN
    -- Full payment: received amount covers expected amount
    new_payment_status := 'Received'::payment_status;
  ELSIF total_transactions > 0 AND calculated_expected = 0 THEN
    -- Payment received but no expected participants set yet
    new_payment_status := 'Received'::payment_status;
  ELSE
    new_payment_status := 'Pending'::payment_status;
  END IF;
  
  -- Update school with calculated values (outstanding_balance will be auto-calculated)
  UPDATE public.schools 
  SET 
    payment_received = total_transactions,
    expected_amount = calculated_expected,
    payment_status = new_payment_status,
    updated_at = now()
  WHERE id = p_school_id;
END;
$function$;

-- Also update the calculate_expected_amount function to use total_participants
CREATE OR REPLACE FUNCTION public.calculate_expected_amount(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  participant_count INTEGER;
  effective_rate NUMERIC;
BEGIN
  -- Get total_participants (manual entry) instead of counting registrations
  SELECT total_participants, effective_rate_per_entry INTO participant_count, effective_rate
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Update expected amount based on total_participants, not student_registrations
  UPDATE public.schools
  SET expected_amount = COALESCE(participant_count, 0) * COALESCE(effective_rate, 150),
      updated_at = now()
  WHERE id = p_school_id;
END;
$function$;

-- Run recalculation for all schools to fix existing data
SELECT public.recalculate_school_payment_totals(id) FROM public.schools;