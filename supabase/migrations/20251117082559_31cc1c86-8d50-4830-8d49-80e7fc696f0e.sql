-- Create function to auto-recalculate payment totals when total_participants changes
CREATE OR REPLACE FUNCTION public.auto_recalculate_on_participants_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only recalculate if total_participants actually changed
  IF OLD.total_participants IS DISTINCT FROM NEW.total_participants THEN
    -- Recalculate expected amount and outstanding balance
    PERFORM public.recalculate_school_payment_totals(NEW.id);
    
    -- Log the automatic recalculation
    PERFORM public.log_security_action(
      'AUTO_PAYMENT_RECALCULATION',
      'schools',
      NEW.id,
      jsonb_build_object('old_participants', OLD.total_participants),
      jsonb_build_object(
        'new_participants', NEW.total_participants,
        'trigger_reason', 'Student registrations changed'
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-recalculate payments when total_participants changes
DROP TRIGGER IF EXISTS trigger_auto_recalculate_on_participants_change ON public.schools;
CREATE TRIGGER trigger_auto_recalculate_on_participants_change
  AFTER UPDATE ON public.schools
  FOR EACH ROW
  WHEN (OLD.total_participants IS DISTINCT FROM NEW.total_participants)
  EXECUTE FUNCTION public.auto_recalculate_on_participants_change();