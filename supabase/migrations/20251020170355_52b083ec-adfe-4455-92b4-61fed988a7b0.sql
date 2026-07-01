
-- Migrate old payment data from schools table to payment_transactions table
-- For schools SS No 2841 and 3075

INSERT INTO payment_transactions (
  school_id,
  payment_date,
  payment_amount,
  payment_mode,
  transaction_reference,
  notes,
  created_by,
  created_at,
  updated_at
)
SELECT 
  s.id as school_id,
  s.payment_date,
  s.payment_amount,
  COALESCE(s.payment_mode, 'Cash') as payment_mode,
  NULL as transaction_reference,
  'Migrated from legacy schools table payment data' as notes,
  '20d0f6a6-2e15-4882-8784-3127376911ea'::uuid as created_by,
  s.updated_at as created_at,
  now() as updated_at
FROM schools s
WHERE s.ss_no IN (2841, 3075)
  AND s.payment_amount IS NOT NULL 
  AND s.payment_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM payment_transactions pt 
    WHERE pt.school_id = s.id
  );
