-- Migrate existing payment data from schools to payment_transactions
-- This ensures the single window payment system works with historical data

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

-- After migration, recalculate all payment totals to ensure consistency
-- This will update payment_received, outstanding_balance, etc.
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT DISTINCT s.id 
        FROM public.schools s
        WHERE s.payment_status = 'Received'
          AND s.payment_amount IS NOT NULL 
          AND s.payment_amount > 0
    LOOP
        PERFORM public.recalculate_school_payment_totals(school_record.id);
    END LOOP;
END $$;

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
  (SELECT user_id FROM public.profiles WHERE role = 'superadmin' LIMIT 1),
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