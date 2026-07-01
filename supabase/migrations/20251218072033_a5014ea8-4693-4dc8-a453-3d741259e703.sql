-- Step 1: Update the trigger function to count ACTIVE participations from student_subjects
CREATE OR REPLACE FUNCTION public.update_total_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected_school_id uuid;
  participation_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'student_registrations' THEN
    IF TG_OP = 'DELETE' THEN
      affected_school_id := OLD.school_id;
    ELSE
      affected_school_id := NEW.school_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'student_subjects' THEN
    IF TG_OP = 'DELETE' THEN
      SELECT school_id INTO affected_school_id FROM public.student_registrations WHERE id = OLD.registration_id;
    ELSE
      SELECT school_id INTO affected_school_id FROM public.student_registrations WHERE id = NEW.registration_id;
    END IF;
  END IF;
  
  IF affected_school_id IS NOT NULL THEN
    SELECT COUNT(*) INTO participation_count
    FROM public.student_subjects ss
    INNER JOIN public.student_registrations sr ON ss.registration_id = sr.id
    WHERE sr.school_id = affected_school_id
    AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%';
    
    UPDATE public.schools SET total_participants = participation_count, updated_at = now() WHERE id = affected_school_id;
  END IF;
  
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Step 2: Add trigger on student_subjects table
DROP TRIGGER IF EXISTS trigger_update_total_participants_subjects ON public.student_subjects;
CREATE TRIGGER trigger_update_total_participants_subjects
  AFTER INSERT OR DELETE ON public.student_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_total_participants();