-- Fix the generate_registration_number function to avoid ambiguous column reference
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_project_year INTEGER;
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
  SELECT op.project_year INTO v_project_year
  FROM public.olympiad_projects op
  WHERE op.id = p_project_id;
  
  -- Convert to last 2 digits (e.g., 2025 -> 25)
  year_code := LPAD((v_project_year % 100)::TEXT, 2, '0');
  
  -- Get school's state and district
  SELECT s.state, s.district INTO school_state, school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Get state code from predefined state_codes table
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(school_state));
  
  -- If state not found in predefined codes, raise error
  IF state_code IS NULL THEN
    RAISE EXCEPTION 'State code not found for state: %. Please ensure the state name matches a predefined state code.', school_state;
  END IF;
  
  -- Get or create district code dynamically
  district_code := get_or_create_district_code(state_code, school_district);
  
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

-- Now update the existing registration
UPDATE student_registrations 
SET registration_number_generated = generate_registration_number(
  school_id, 
  project_id, 
  student_class
)
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
AND registration_number_generated IS NULL;