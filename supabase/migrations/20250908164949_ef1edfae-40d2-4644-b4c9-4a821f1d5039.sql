-- Update the generate_registration_number function to use the populated state and district codes
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  project_year INTEGER;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  student_code TEXT;
  registration_number TEXT;
  school_state TEXT;
  school_district TEXT;
BEGIN
  -- Get project year
  SELECT project_year INTO project_year
  FROM public.olympiad_projects
  WHERE id = p_project_id;
  
  -- Get school's state and district
  SELECT state, district INTO school_state, school_district
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Get state code from state_codes table
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(school_state));
  
  -- If state not found, use default
  IF state_code IS NULL THEN
    state_code := '00';
  END IF;
  
  -- Get district code from district_codes table
  SELECT dc.district_code INTO district_code
  FROM public.district_codes dc
  WHERE dc.state_code = state_code 
    AND UPPER(TRIM(dc.district_name)) = UPPER(TRIM(school_district));
  
  -- If district not found, use default
  IF district_code IS NULL THEN
    district_code := '000';
  END IF;
  
  -- Get or assign school code
  school_code := assign_school_code(p_school_id, state_code, district_code);
  
  -- Get class code
  class_code := get_class_code(p_student_class);
  
  IF class_code IS NULL THEN
    RAISE EXCEPTION 'Invalid student class: %', p_student_class;
  END IF;
  
  -- Get next student sequence
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- Format student code (class_code + 3-digit sequence)
  student_code := class_code::TEXT || LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number: YEAR-STATE-DISTRICT-SCHOOL-STUDENT
  registration_number := project_year::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;

-- Add trigger to automatically generate registration numbers when students are registered
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only generate if registration_number_generated is not already set
  IF NEW.registration_number_generated IS NULL THEN
    NEW.registration_number_generated := generate_registration_number(
      NEW.school_id, 
      NEW.project_id, 
      NEW.student_class
    );
    
    -- Also set the class_code for consistency
    NEW.class_code := get_class_code(NEW.student_class);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger on student_registrations table
CREATE TRIGGER trigger_auto_generate_registration_number
  BEFORE INSERT ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_registration_number();