-- Update the generate_registration_number function to use last 2 digits of year
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  project_year INTEGER;
  year_code TEXT;
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
  
  -- Convert to last 2 digits (e.g., 2025 -> 25)
  year_code := LPAD((project_year % 100)::TEXT, 2, '0');
  
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
  
  -- Generate final registration number: YY-STATE-DISTRICT-SCHOOL-STUDENT
  registration_number := year_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;