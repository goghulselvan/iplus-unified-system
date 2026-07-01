-- Fix the RLS function to properly check for accountant permissions
CREATE OR REPLACE FUNCTION public.is_accountant_or_above()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role IN ('accountant', 'manager', 'superadmin')
  );
$function$;

-- Also update the payment transactions function to be less restrictive for now
CREATE OR REPLACE FUNCTION public.get_payment_transactions_for_accountant()
RETURNS TABLE(
  transaction_id UUID,
  school_id UUID,
  ss_no INTEGER,
  school_name TEXT,
  district TEXT,
  state TEXT,
  payment_date DATE,
  payment_amount NUMERIC,
  payment_mode TEXT,
  registration_count BIGINT,
  expected_amount NUMERIC,
  total_received NUMERIC,
  outstanding_balance NUMERIC,
  transaction_reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- First try to get data from the new payment_transactions table
  SELECT 
    pt.id as transaction_id,
    s.id as school_id,
    s.ss_no,
    s.school_name,
    s.district,
    s.state,
    pt.payment_date,
    pt.payment_amount,
    pt.payment_mode,
    COALESCE(reg_count.registration_count, 0)::bigint AS registration_count,
    s.expected_amount,
    s.payment_received as total_received,
    s.outstanding_balance,
    pt.transaction_reference,
    pt.created_at
  FROM public.payment_transactions pt
  JOIN public.schools s ON pt.school_id = s.id
  LEFT JOIN (
    SELECT 
      sr.school_id,
      COUNT(*) AS registration_count
    FROM public.student_registrations sr
    GROUP BY sr.school_id
  ) reg_count ON s.id = reg_count.school_id
  
  UNION ALL
  
  -- If no payment transactions exist, show data from legacy schools table
  SELECT 
    s.id as transaction_id, -- Use school id as transaction id for legacy data
    s.id as school_id,
    s.ss_no,
    s.school_name,
    s.district,
    s.state,
    s.payment_date,
    s.payment_amount,
    s.payment_mode,
    COALESCE(reg_count.registration_count, 0)::bigint AS registration_count,
    COALESCE(s.expected_amount, reg_count.registration_count * COALESCE(s.effective_rate_per_entry, s.per_entry_rate - s.concession_per_entry, 150)) as expected_amount,
    COALESCE(s.payment_received, s.payment_amount, 0) as total_received,
    GREATEST(COALESCE(s.expected_amount, reg_count.registration_count * COALESCE(s.effective_rate_per_entry, s.per_entry_rate - s.concession_per_entry, 150)) - COALESCE(s.payment_received, s.payment_amount, 0), 0) as outstanding_balance,
    NULL as transaction_reference,
    s.created_at
  FROM public.schools s
  LEFT JOIN (
    SELECT 
      sr.school_id,
      COUNT(*) AS registration_count
    FROM public.student_registrations sr
    GROUP BY sr.school_id
  ) reg_count ON s.id = reg_count.school_id
  WHERE s.payment_status = 'Received'
    AND NOT EXISTS (SELECT 1 FROM public.payment_transactions) -- Only show legacy data if no new transactions exist
  
  ORDER BY payment_date DESC, created_at DESC;
$function$;