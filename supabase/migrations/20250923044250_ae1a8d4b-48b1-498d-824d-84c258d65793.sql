-- Add enhanced payment tracking columns to schools table
ALTER TABLE public.schools 
ADD COLUMN per_entry_rate NUMERIC DEFAULT 150,
ADD COLUMN concession_per_entry NUMERIC DEFAULT 0,
ADD COLUMN effective_rate_per_entry NUMERIC GENERATED ALWAYS AS (per_entry_rate - concession_per_entry) STORED,
ADD COLUMN expected_amount NUMERIC DEFAULT 0,
ADD COLUMN payment_received NUMERIC DEFAULT 0,
ADD COLUMN outstanding_balance NUMERIC GENERATED ALWAYS AS (expected_amount - payment_received) STORED;

-- Create function to calculate expected amount based on registrations
CREATE OR REPLACE FUNCTION public.calculate_expected_amount(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  registration_count INTEGER;
  effective_rate NUMERIC;
BEGIN
  -- Count student registrations for this school
  SELECT COUNT(*) INTO registration_count
  FROM public.student_registrations
  WHERE school_id = p_school_id;
  
  -- Get effective rate for this school
  SELECT effective_rate_per_entry INTO effective_rate
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Update expected amount
  UPDATE public.schools
  SET expected_amount = registration_count * COALESCE(effective_rate, 150),
      updated_at = now()
  WHERE id = p_school_id;
END;
$function$;

-- Create trigger to auto-calculate expected amount when registrations change
CREATE OR REPLACE FUNCTION public.auto_calculate_expected_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Calculate expected amount for the affected school
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.calculate_expected_amount(NEW.school_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.calculate_expected_amount(OLD.school_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Create trigger on student_registrations to auto-calculate expected amounts
DROP TRIGGER IF EXISTS trigger_auto_calculate_expected_amount ON public.student_registrations;
CREATE TRIGGER trigger_auto_calculate_expected_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_calculate_expected_amount();

-- Create trigger to recalculate expected amount when per_entry_rate or concession changes
CREATE OR REPLACE FUNCTION public.auto_recalculate_on_rate_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If per_entry_rate or concession_per_entry changed, recalculate expected amount
  IF (OLD.per_entry_rate IS DISTINCT FROM NEW.per_entry_rate) OR 
     (OLD.concession_per_entry IS DISTINCT FROM NEW.concession_per_entry) THEN
    PERFORM public.calculate_expected_amount(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Create trigger on schools table for rate changes
DROP TRIGGER IF EXISTS trigger_auto_recalculate_on_rate_change ON public.schools;
CREATE TRIGGER trigger_auto_recalculate_on_rate_change
  AFTER UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_recalculate_on_rate_change();

-- Initialize expected amounts for existing schools
UPDATE public.schools 
SET expected_amount = (
  SELECT COUNT(*) * COALESCE(effective_rate_per_entry, 150)
  FROM public.student_registrations sr
  WHERE sr.school_id = schools.id
);

-- Update payment_received with existing payment_amount data
UPDATE public.schools 
SET payment_received = COALESCE(payment_amount, 0)
WHERE payment_amount IS NOT NULL;