-- Update the generate_registration_number function to use subject codes instead of fixed "0"
-- This version takes subject_id parameter to determine the correct subject code
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text, p_subject_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  subject_code INTEGER;
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
  -- Get subject code based on subject_id
  subject_code := get_subject_code(p_subject_id);
  
  IF subject_code IS NULL THEN
    RAISE EXCEPTION 'Invalid or unknown subject ID: %', p_subject_id;
  END IF;

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
  
  -- Generate final registration number: SUBJECT-STATE-DISTRICT-SCHOOL-STUDENT
  registration_number := subject_code::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;

-- Update the existing test registration with proper subject code
UPDATE student_registrations 
SET registration_number_generated = generate_registration_number(
  school_id, 
  project_id, 
  student_class,
  (SELECT subject_id FROM student_subjects WHERE registration_id = student_registrations.id LIMIT 1)
)
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90';