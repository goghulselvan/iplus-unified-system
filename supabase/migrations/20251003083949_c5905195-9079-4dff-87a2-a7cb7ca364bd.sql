-- Create receipt_numbers table for tracking sequential receipt numbers
CREATE TABLE public.receipt_numbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_transaction_id UUID NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  receipt_number INTEGER NOT NULL UNIQUE,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.receipt_numbers ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX idx_receipt_numbers_payment_transaction_id ON public.receipt_numbers(payment_transaction_id);
CREATE INDEX idx_receipt_numbers_receipt_number ON public.receipt_numbers(receipt_number);

-- RLS Policies: Only accountants and above can view receipt numbers
CREATE POLICY "Accountants can view receipt numbers"
  ON public.receipt_numbers
  FOR SELECT
  USING (is_accountant_or_above());

-- Create sequence for receipt numbers (starts from 1)
CREATE SEQUENCE IF NOT EXISTS public.receipt_number_seq START WITH 1;

-- Function to generate next receipt number
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  next_receipt_no INTEGER;
BEGIN
  -- Get next value from sequence
  next_receipt_no := nextval('receipt_number_seq');
  
  -- Insert receipt number for this payment transaction
  INSERT INTO public.receipt_numbers (payment_transaction_id, receipt_number, generated_at)
  VALUES (NEW.id, next_receipt_no, now());
  
  RETURN NEW;
END;
$$;

-- Trigger to auto-generate receipt number when payment transaction is created
CREATE TRIGGER auto_generate_receipt_number
  AFTER INSERT ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_receipt_number();

-- Backfill existing payment transactions with receipt numbers
DO $$
DECLARE
  payment_rec RECORD;
  next_receipt_no INTEGER := 1;
BEGIN
  FOR payment_rec IN 
    SELECT pt.id, pt.created_at 
    FROM public.payment_transactions pt
    LEFT JOIN public.receipt_numbers rn ON rn.payment_transaction_id = pt.id
    WHERE rn.id IS NULL
    ORDER BY pt.created_at ASC
  LOOP
    INSERT INTO public.receipt_numbers (payment_transaction_id, receipt_number, generated_at)
    VALUES (payment_rec.id, next_receipt_no, payment_rec.created_at);
    
    next_receipt_no := next_receipt_no + 1;
  END LOOP;
  
  -- Update sequence to continue from the last backfilled number
  IF next_receipt_no > 1 THEN
    PERFORM setval('receipt_number_seq', next_receipt_no - 1);
  END IF;
END $$;