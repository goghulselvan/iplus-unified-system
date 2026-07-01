-- Create function to automatically create payment transaction when workflow updates payment status
CREATE OR REPLACE FUNCTION public.create_payment_transaction_from_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_existing_transaction_count integer;
BEGIN
  -- Only proceed if payment_status changed to 'Received' or 'Partial'
  -- AND payment details are present
  IF (NEW.payment_status IN ('Received', 'Partial')) AND
     (OLD.payment_status IS NULL OR OLD.payment_status != NEW.payment_status) AND
     NEW.payment_amount IS NOT NULL AND
     NEW.payment_date IS NOT NULL THEN
    
    -- Check if a transaction already exists for this payment
    -- (to avoid duplicates if trigger fires multiple times)
    SELECT COUNT(*) INTO v_existing_transaction_count
    FROM public.payment_transactions
    WHERE school_id = NEW.id
      AND payment_date = NEW.payment_date
      AND payment_amount = NEW.payment_amount
      AND notes ILIKE '%workflow%';
    
    -- Only create if no duplicate exists
    IF v_existing_transaction_count = 0 THEN
      -- Get current user (or use a system user if unavailable)
      v_user_id := COALESCE(
        auth.uid(), 
        (SELECT user_id FROM profiles WHERE role = 'superadmin' LIMIT 1)
      );
      
      -- Create payment transaction record
      INSERT INTO public.payment_transactions (
        school_id,
        payment_date,
        payment_amount,
        payment_mode,
        notes,
        created_by
      ) VALUES (
        NEW.id,
        NEW.payment_date,
        NEW.payment_amount,
        COALESCE(NEW.payment_mode, 'Cash'),
        'Payment recorded via workflow editor',
        v_user_id
      );
      
      -- Log the automatic transaction creation
      PERFORM public.log_security_action(
        'AUTO_PAYMENT_TRANSACTION_CREATED',
        'payment_transactions',
        NEW.id,
        NULL,
        jsonb_build_object(
          'school_id', NEW.id,
          'payment_amount', NEW.payment_amount,
          'payment_date', NEW.payment_date,
          'trigger_reason', 'Workflow payment status update'
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-create payment transaction on workflow payment update
DROP TRIGGER IF EXISTS trigger_create_payment_transaction_on_workflow_update ON public.schools;
CREATE TRIGGER trigger_create_payment_transaction_on_workflow_update
  AFTER UPDATE ON public.schools
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION public.create_payment_transaction_from_workflow();