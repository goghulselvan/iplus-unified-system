-- Fix the recalculate function to handle generated columns properly
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_received NUMERIC;
  reg_count INTEGER;
  effective_rate NUMERIC;
  expected_amt NUMERIC;
BEGIN
  -- Get total received from all transactions
  SELECT COALESCE(SUM(payment_amount), 0) INTO total_received
  FROM public.payment_transactions
  WHERE school_id = p_school_id;
  
  -- Get registration count and effective rate
  SELECT COUNT(*) INTO reg_count
  FROM public.student_registrations
  WHERE school_id = p_school_id;
  
  SELECT COALESCE(effective_rate_per_entry, per_entry_rate - concession_per_entry, 150) INTO effective_rate
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Calculate expected amount
  expected_amt := reg_count * effective_rate;
  
  -- Update school record WITHOUT outstanding_balance (it's generated)
  UPDATE public.schools
  SET 
    payment_received = total_received,
    expected_amount = expected_amt,
    outstanding_balance = DEFAULT,  -- Use DEFAULT for generated column
    payment_status = CASE 
      WHEN total_received = 0 THEN 'Pending'::payment_status
      WHEN (expected_amt - total_received) > 0 THEN 'Partial'::payment_status
      ELSE 'Received'::payment_status
    END,
    updated_at = now()
  WHERE id = p_school_id;
END;
$function$;

-- Now migrate existing payment data from schools to payment_transactions
INSERT INTO public.payment_transactions (
  school_id,
  payment_date,
  payment_amount,
  payment_mode,
  transaction_reference,
  notes,
  created_by
)
SELECT 
  s.id as school_id,
  COALESCE(s.payment_date, s.created_at::date) as payment_date,
  s.payment_amount,
  COALESCE(s.payment_mode, 'Cash') as payment_mode,
  'Legacy Migration' as transaction_reference,
  'Migrated from workflow payment data' as notes,
  (SELECT user_id FROM public.profiles WHERE role = 'superadmin' LIMIT 1) as created_by
FROM public.schools s
WHERE s.payment_status = 'Received'
  AND s.payment_amount IS NOT NULL 
  AND s.payment_amount > 0
  -- Only migrate if no payment transaction already exists for this school
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions pt 
    WHERE pt.school_id = s.id
  );

-- Log the migration completion
INSERT INTO public.security_audit_logs (
  user_id, 
  action, 
  table_name, 
  record_id, 
  old_values, 
  new_values, 
  ip_address
) VALUES (
  COALESCE(
    (SELECT user_id FROM public.profiles WHERE role = 'superadmin' LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ),
  'PAYMENT_DATA_MIGRATION',
  'payment_transactions',
  NULL,
  NULL,
  jsonb_build_object(
    'migration_type', 'schools_to_payment_transactions',
    'timestamp', now(),
    'migrated_count', (
      SELECT COUNT(*) FROM public.payment_transactions 
      WHERE transaction_reference = 'Legacy Migration'
    )
  ),
  '127.0.0.1'::inet
);