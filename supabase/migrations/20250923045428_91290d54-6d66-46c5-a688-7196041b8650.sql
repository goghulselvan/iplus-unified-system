-- Create payment_transactions table for individual payment tracking
CREATE TABLE public.payment_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  payment_amount NUMERIC(10,2) NOT NULL CHECK (payment_amount > 0),
  payment_mode TEXT NOT NULL DEFAULT 'Cash',
  transaction_reference TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on payment_transactions
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for payment_transactions
CREATE POLICY "Accountants can view payment transactions" 
ON public.payment_transactions 
FOR SELECT 
USING (is_accountant_or_above());

CREATE POLICY "Accountants can insert payment transactions" 
ON public.payment_transactions 
FOR INSERT 
WITH CHECK (is_accountant_or_above() AND auth.uid() = created_by);

CREATE POLICY "Accountants can update payment transactions" 
ON public.payment_transactions 
FOR UPDATE 
USING (is_accountant_or_above());

-- Create indexes for performance
CREATE INDEX idx_payment_transactions_school_id ON public.payment_transactions(school_id);
CREATE INDEX idx_payment_transactions_payment_date ON public.payment_transactions(payment_date);

-- Create trigger for updated_at
CREATE TRIGGER update_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to recalculate school payment totals
CREATE OR REPLACE FUNCTION public.recalculate_school_payment_totals(p_school_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  total_received NUMERIC;
  reg_count INTEGER;
  effective_rate NUMERIC;
  expected_amt NUMERIC;
  outstanding_amt NUMERIC;
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
  
  -- Calculate outstanding balance
  outstanding_amt := GREATEST(expected_amt - total_received, 0);
  
  -- Update school record
  UPDATE public.schools
  SET 
    payment_received = total_received,
    expected_amount = expected_amt,
    outstanding_balance = outstanding_amt,
    payment_status = CASE 
      WHEN total_received = 0 THEN 'Pending'::payment_status
      WHEN outstanding_amt > 0 THEN 'Partial'::payment_status
      ELSE 'Received'::payment_status
    END,
    updated_at = now()
  WHERE id = p_school_id;
END;
$function$;

-- Trigger to auto-recalculate totals when payment transactions change
CREATE OR REPLACE FUNCTION public.auto_recalculate_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Recalculate for the affected school
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.recalculate_school_payment_totals(NEW.school_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_school_payment_totals(OLD.school_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER auto_recalculate_payment_totals_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_recalculate_payment_totals();

-- Enhanced function to get payment transactions for accountant dashboard
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
  WHERE is_accountant_or_above()
  ORDER BY pt.payment_date DESC, pt.created_at DESC;
$function$;

-- Add new payment status for partial payments
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'Partial';