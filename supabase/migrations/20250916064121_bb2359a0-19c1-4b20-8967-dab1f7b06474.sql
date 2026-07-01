-- Create helper functions for accountant role
CREATE OR REPLACE FUNCTION public.is_accountant()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'accountant'
  );
$$;

-- Create a function to check if user is accountant or above
CREATE OR REPLACE FUNCTION public.is_accountant_or_above()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role IN ('accountant', 'manager', 'superadmin')
  );
$$;

-- Create a view for accountant dashboard data
CREATE OR REPLACE VIEW public.accountant_payment_view AS
SELECT 
  s.id,
  s.ss_no,
  s.school_name,
  s.payment_date,
  s.payment_amount,
  s.payment_mode,
  s.district,
  s.state,
  COALESCE(
    (SELECT COUNT(*) 
     FROM student_registrations sr 
     WHERE sr.school_id = s.id 
     AND sr.project_id = s.current_project_id), 0
  ) as registration_count,
  s.created_at,
  s.updated_at
FROM schools s
WHERE s.payment_status = 'Received'
ORDER BY s.payment_date DESC NULLS LAST, s.created_at DESC;

-- Grant access to accountants for the payment view
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- Create a function to get accountant dashboard metrics
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
RETURNS TABLE(
  total_paid_schools bigint,
  total_registrations bigint,
  total_payment_amount numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    COUNT(*) as total_paid_schools,
    COALESCE(SUM(
      (SELECT COUNT(*) 
       FROM student_registrations sr 
       WHERE sr.school_id = s.id 
       AND sr.project_id = s.current_project_id)
    ), 0) as total_registrations,
    COALESCE(SUM(s.payment_amount), 0) as total_payment_amount
  FROM schools s
  WHERE s.payment_status = 'Received';
$$;