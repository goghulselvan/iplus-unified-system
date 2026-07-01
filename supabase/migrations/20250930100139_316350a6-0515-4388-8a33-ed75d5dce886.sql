
-- Fix ambiguous column reference in handle_new_student_subject
-- The variable 'registration_number' conflicts with column name
CREATE OR REPLACE FUNCTION public.handle_new_student_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_registration_number text;
  v_school_id uuid;
  v_project_id uuid;
  v_student_class text;
BEGIN
  -- Get registration details first
  SELECT school_id, project_id, student_class
  INTO v_school_id, v_project_id, v_student_class
  FROM student_registrations 
  WHERE id = NEW.registration_id;
  
  -- Generate registration number when student_subjects is created
  v_registration_number := build_student_registration_number(
    v_school_id,
    v_project_id,
    v_student_class,
    NEW.subject_id
  );
  
  -- Update the student registration with the generated number
  UPDATE public.student_registrations 
  SET registration_number_generated = v_registration_number
  WHERE id = NEW.registration_id;
  
  RETURN NEW;
END;
$function$;
