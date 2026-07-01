-- Fix the trigger function to eliminate subject_code ambiguity
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_registration_number_result text;
  v_school_id uuid;
  v_project_id uuid;
  v_student_class text;
BEGIN
  -- For student_registrations table: do nothing, registration number will be generated after subject association
  IF TG_TABLE_NAME = 'student_registrations' THEN
    RETURN NEW;
  END IF;
  
  -- For student_subjects table: generate registration number when subject is associated
  IF TG_TABLE_NAME = 'student_subjects' THEN
    -- Check if registration number already exists
    SELECT sr.registration_number_generated 
    INTO v_registration_number_result
    FROM public.student_registrations sr
    WHERE sr.id = NEW.registration_id;
    
    -- Generate registration number if it doesn't exist
    IF v_registration_number_result IS NULL THEN
      -- Get school, project, and class info first to avoid ambiguity in function call
      SELECT sr.school_id, sr.project_id, sr.student_class
      INTO v_school_id, v_project_id, v_student_class
      FROM public.student_registrations sr
      WHERE sr.id = NEW.registration_id;
      
      -- Now generate the registration number with explicit variables
      v_registration_number_result := public.generate_registration_number(
        v_school_id, 
        v_project_id, 
        v_student_class,
        NEW.subject_id
      );
      
      -- Update the registration with the generated number
      UPDATE public.student_registrations 
      SET 
        registration_number_generated = v_registration_number_result,
        class_code = public.map_student_class_to_code(v_student_class),
        updated_at = now()
      WHERE id = NEW.registration_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;