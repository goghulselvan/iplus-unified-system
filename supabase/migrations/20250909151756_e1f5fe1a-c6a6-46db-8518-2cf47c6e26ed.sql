-- Update get_class_code function to return class-based codes
CREATE OR REPLACE FUNCTION public.get_class_code(student_class text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  CASE UPPER(TRIM(student_class))
    WHEN 'LKG' THEN RETURN 9;
    WHEN 'UKG' THEN RETURN 0;
    WHEN 'CLASS 1', '1' THEN RETURN 1;
    WHEN 'CLASS 2', '2' THEN RETURN 2;
    WHEN 'CLASS 3', '3' THEN RETURN 3;
    WHEN 'CLASS 4', '4' THEN RETURN 4;
    WHEN 'CLASS 5', '5' THEN RETURN 5;
    WHEN 'CLASS 6', '6' THEN RETURN 6;
    WHEN 'CLASS 7', '7' THEN RETURN 7;
    WHEN 'CLASS 8', '8' THEN RETURN 8;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Create function to get subject code from subject ID
CREATE OR REPLACE FUNCTION public.get_subject_code(p_subject_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  subject_name text;
BEGIN
  SELECT UPPER(TRIM(os.subject_name)) INTO subject_name
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  IF subject_name IS NULL THEN
    RETURN NULL;
  END IF;
  
  CASE subject_name
    WHEN 'KIDS' THEN RETURN 0;
    WHEN 'ENGLISH' THEN RETURN 1;
    WHEN 'MATHS', 'MATHEMATICS' THEN RETURN 2;
    WHEN 'SCIENCE' THEN RETURN 3;
    WHEN 'GK', 'GENERAL KNOWLEDGE' THEN RETURN 4;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Update generate_registration_number function to use new format
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
  -- Get subject code
  subject_code := get_subject_code(p_subject_id);
  
  IF subject_code IS NULL THEN
    RAISE EXCEPTION 'Invalid or unknown subject ID: %', p_subject_id;
  END IF;
  
  -- Get school's state and district
  SELECT state, district INTO school_state, school_district
  FROM public.schools
  WHERE id = p_school_id;
  
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
  
  -- Get next student sequence for this school/project/class/subject combination
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- Format student code with class as first digit (e.g., 1001, 2045, 9001)
  student_code := class_code::TEXT || LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number: SUBJECT-STATE-DISTRICT-SCHOOL-STUDENT
  registration_number := subject_code::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;

-- Update auto_generate_registration_number trigger to work with subject_id
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  subject_id uuid;
BEGIN
  -- Only generate if registration_number_generated is not already set
  IF NEW.registration_number_generated IS NULL THEN
    -- Get the first subject_id for this registration from student_subjects
    SELECT ss.subject_id INTO subject_id
    FROM public.student_subjects ss
    WHERE ss.registration_id = NEW.id
    LIMIT 1;
    
    -- If no subject found, we can't generate the registration number yet
    IF subject_id IS NULL THEN
      NEW.registration_number_generated := NULL;
    ELSE
      NEW.registration_number_generated := generate_registration_number(
        NEW.school_id, 
        NEW.project_id, 
        NEW.student_class,
        subject_id
      );
    END IF;
    
    -- Also set the class_code for consistency
    NEW.class_code := get_class_code(NEW.student_class);
  END IF;
  
  RETURN NEW;
END;
$function$;