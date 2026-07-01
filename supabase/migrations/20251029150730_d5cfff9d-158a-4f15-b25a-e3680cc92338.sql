-- Create function to update total_participants based on actual student registrations
CREATE OR REPLACE FUNCTION public.update_total_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected_school_id uuid;
  registration_count INTEGER;
BEGIN
  -- Determine which school was affected
  IF TG_OP = 'DELETE' THEN
    affected_school_id := OLD.school_id;
  ELSE
    affected_school_id := NEW.school_id;
  END IF;
  
  -- Count actual student registrations for this school
  SELECT COUNT(*) INTO registration_count
  FROM public.student_registrations
  WHERE school_id = affected_school_id;
  
  -- Update total_participants in schools table
  UPDATE public.schools
  SET total_participants = registration_count,
      updated_at = now()
  WHERE id = affected_school_id;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Create trigger on student_registrations to auto-update total_participants
DROP TRIGGER IF EXISTS trigger_update_total_participants ON public.student_registrations;
CREATE TRIGGER trigger_update_total_participants
  AFTER INSERT OR DELETE ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_total_participants();

-- Initialize total_participants for all existing schools based on actual registrations
UPDATE public.schools 
SET total_participants = (
  SELECT COUNT(*)
  FROM public.student_registrations sr
  WHERE sr.school_id = schools.id
)
WHERE id IN (SELECT DISTINCT school_id FROM public.student_registrations);