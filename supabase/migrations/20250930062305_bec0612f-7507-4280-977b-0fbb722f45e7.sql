-- Fix the registration number generation trigger
-- The current trigger runs BEFORE UPDATE, but the subject association doesn't exist yet
-- We need to change it to run AFTER INSERT and also add an AFTER INSERT trigger for student_subjects

-- Drop the existing trigger
DROP TRIGGER IF EXISTS trigger_auto_generate_registration_number ON public.student_registrations;

-- Update the trigger function to work properly
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  subject_id uuid;
  registration_number_result text;
BEGIN
  -- For student_registrations table: do nothing, registration number will be generated after subject association
  IF TG_TABLE_NAME = 'student_registrations' THEN
    RETURN NEW;
  END IF;
  
  -- For student_subjects table: generate registration number when subject is associated
  IF TG_TABLE_NAME = 'student_subjects' THEN
    -- Check if registration number already exists
    SELECT registration_number_generated INTO registration_number_result
    FROM public.student_registrations 
    WHERE id = NEW.registration_id;
    
    -- Generate registration number if it doesn't exist
    IF registration_number_result IS NULL THEN
      -- Generate the registration number
      SELECT generate_registration_number(
        sr.school_id, 
        sr.project_id, 
        sr.student_class,
        NEW.subject_id
      ) INTO registration_number_result
      FROM public.student_registrations sr
      WHERE sr.id = NEW.registration_id;
      
      -- Update the registration with the generated number
      UPDATE public.student_registrations 
      SET 
        registration_number_generated = registration_number_result,
        class_code = get_class_code(student_class),
        updated_at = now()
      WHERE id = NEW.registration_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger on student_subjects table to generate registration numbers
CREATE TRIGGER trigger_generate_registration_number_on_subject
    AFTER INSERT ON public.student_subjects
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_generate_registration_number();