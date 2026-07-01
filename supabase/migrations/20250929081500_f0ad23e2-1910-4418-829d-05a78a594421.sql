-- Create function to auto-confirm registration when payment received and name list uploaded
CREATE OR REPLACE FUNCTION public.auto_confirm_registration()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if payment is received and name list is uploaded
  IF NEW.payment_status = 'Received' AND NEW.name_list_status = 'Uploaded' THEN
    -- Only update if registration status is not already Confirmed
    IF NEW.registration_status != 'Confirmed' THEN
      NEW.registration_status = 'Confirmed';
      NEW.updated_at = now();
      
      -- Log this automatic change
      PERFORM public.log_security_action(
        'AUTO_REGISTRATION_CONFIRMED',
        'schools',
        NEW.id,
        jsonb_build_object('old_registration_status', OLD.registration_status),
        jsonb_build_object(
          'new_registration_status', 'Confirmed',
          'payment_status', NEW.payment_status,
          'name_list_status', NEW.name_list_status,
          'trigger_reason', 'Payment received and name list uploaded'
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to run the function before update on schools table
DROP TRIGGER IF EXISTS trigger_auto_confirm_registration ON public.schools;
CREATE TRIGGER trigger_auto_confirm_registration
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_registration();