-- Drop the existing function and recreate with NEW FORMAT
DROP FUNCTION IF EXISTS public.generate_registration_number(uuid, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.generate_registration_number(uuid, uuid, text);

-- Create the NEW FORMAT function: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid, 
  p_project_id uuid, 
  p_student_class text,
  p_subject_id uuid,
  p_student_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  subject_code INTEGER;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  registration_number TEXT;
  school_state TEXT;
  school_district TEXT;
BEGIN
  -- Get subject code (required in new format)
  subject_code := get_subject_code(p_subject_id);
  IF subject_code IS NULL THEN
    RAISE EXCEPTION 'Subject code not found for subject: %', p_subject_id;
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
  
  -- Get next student sequence (ensures sequential numbering)
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- NEW FORMAT: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  -- Format: [1-5]-[12]-[001]-[001]-[1]-[001]
  registration_number := subject_code::TEXT || '-' || 
                         state_code || '-' || 
                         district_code || '-' || 
                         school_code || '-' || 
                         class_code::TEXT || '-' || 
                         LPAD(student_seq::TEXT, 3, '0');
  
  RETURN registration_number;
END;
$$;