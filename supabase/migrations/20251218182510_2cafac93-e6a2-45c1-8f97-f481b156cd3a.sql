
-- Fix recalculate_school_payment_totals to also update outstanding_balance and effective_rate
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_transactions NUMERIC := 0;
  school_data RECORD;
  calculated_expected NUMERIC;
  calculated_effective_rate NUMERIC;
  calculated_outstanding NUMERIC;
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
  
  -- Calculate effective rate (per_entry_rate - concession)
  calculated_effective_rate := COALESCE(school_data.per_entry_rate, 150) - COALESCE(school_data.concession_per_entry, 0);
  
  -- Calculate expected amount using total_participants and effective rate
  calculated_expected := COALESCE(school_data.total_participants, 0) * calculated_effective_rate;
  
  -- Calculate outstanding balance (can be negative if overpaid, but we'll track it)
  calculated_outstanding := calculated_expected - total_transactions;
  
  -- Determine payment status based on payments vs expected amount
  IF total_transactions = 0 THEN
    new_payment_status := 'Pending'::payment_status;
  ELSIF total_transactions > 0 AND calculated_outstanding > 0 THEN
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
  
  -- Update school with ALL calculated values
  UPDATE public.schools 
  SET 
    effective_rate_per_entry = calculated_effective_rate,
    expected_amount = calculated_expected,
    payment_received = total_transactions,
    outstanding_balance = calculated_outstanding,
    payment_status = new_payment_status,
    updated_at = now()
  WHERE id = p_school_id;
END;
$$;