-- Function to automatically update registration status when payment is received
CREATE OR REPLACE FUNCTION public.auto_update_registration_status_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- If payment status is being set to 'Received', automatically set registration status to 'Confirmed'
  IF NEW.payment_status = 'Received' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'Received') THEN
    NEW.registration_status = 'Confirmed';
    
    -- Log the automatic status change
    PERFORM public.log_security_action(
      'AUTO_REGISTRATION_STATUS_UPDATE',
      'schools',
      NEW.id,
      jsonb_build_object('old_registration_status', OLD.registration_status, 'old_payment_status', OLD.payment_status),
      jsonb_build_object('new_registration_status', NEW.registration_status, 'new_payment_status', NEW.payment_status, 'auto_updated', true)
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically update registration status when payment is received
DROP TRIGGER IF EXISTS trigger_auto_update_registration_status_on_payment ON public.schools;
CREATE TRIGGER trigger_auto_update_registration_status_on_payment
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_update_registration_status_on_payment();

-- Update existing schools where payment is received but registration status is not confirmed
UPDATE public.schools 
SET registration_status = 'Confirmed', updated_at = now()
WHERE payment_status = 'Received' 
  AND registration_status != 'Confirmed';

-- Log the bulk update for existing schools
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, 
  old_values, new_values, ip_address
) 
SELECT 
  '6db65195-f608-46d7-8691-4af7b2a73d39'::uuid, -- Current superadmin user ID
  'BULK_AUTO_REGISTRATION_STATUS_UPDATE',
  'schools',
  id,
  jsonb_build_object('registration_status', 'previous_status'),
  jsonb_build_object('registration_status', 'Confirmed', 'reason', 'Auto-update for existing paid schools'),
  inet_client_addr()
FROM public.schools
WHERE payment_status = 'Received' 
  AND registration_status = 'Confirmed';