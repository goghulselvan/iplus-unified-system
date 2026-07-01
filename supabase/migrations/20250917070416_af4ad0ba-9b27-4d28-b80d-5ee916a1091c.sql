-- Fix the security issues by dropping and recreating the view without SECURITY DEFINER
-- and ensuring proper RLS policies

DROP VIEW IF EXISTS accountant_payment_view;

-- Create the view without SECURITY DEFINER to avoid security issues
CREATE VIEW accountant_payment_view AS
SELECT 
  s.id,
  s.ss_no,
  s.school_name,
  s.district,
  s.state,
  s.payment_date,
  s.payment_amount,
  s.payment_mode,
  s.created_at,
  s.updated_at,
  COALESCE((
    SELECT COUNT(*) 
    FROM student_registrations sr 
    WHERE sr.school_id = s.id
  ), 0) as registration_count
FROM schools s
WHERE s.payment_status = 'Received';

-- Enable RLS on the view
ALTER VIEW accountant_payment_view SET (security_barrier=true);

-- Create RLS policy for the view to allow accountants and managers to access
CREATE POLICY "Accountants and managers can view payment data" 
ON accountant_payment_view 
FOR SELECT 
USING (is_accountant_or_above());