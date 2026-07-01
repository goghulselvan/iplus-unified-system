-- Create trigger function to auto-maintain registration_number_digits
CREATE OR REPLACE FUNCTION public.maintain_registration_number_digits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.registration_number_generated IS NOT NULL THEN
    NEW.registration_number_digits := regexp_replace(NEW.registration_number_generated, '\D', '', 'g');
  ELSE
    NEW.registration_number_digits := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger
DROP TRIGGER IF EXISTS trg_maintain_registration_digits ON public.student_registrations;
CREATE TRIGGER trg_maintain_registration_digits
BEFORE INSERT OR UPDATE OF registration_number_generated ON public.student_registrations
FOR EACH ROW
EXECUTE FUNCTION public.maintain_registration_number_digits()