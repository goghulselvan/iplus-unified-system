-- More aggressive cleanup of duplicate functions
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Find all generate_registration_number functions and drop them
    FOR r IN SELECT specific_name FROM information_schema.routines 
             WHERE routine_name = 'generate_registration_number' 
             AND routine_schema = 'public'
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || r.specific_name || ' CASCADE';
    END LOOP;
END $$;

-- Now recreate the single correct function
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
  
  IF school_state IS NULL OR school_district IS NULL THEN
    RAISE EXCEPTION 'School state or district not found for school ID: %', p_school_id;
  END IF;
  
  -- Get or create state code
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(school_state));
  
  IF state_code IS NULL THEN
    RAISE EXCEPTION 'State code not found for state: %', school_state;
  END IF;
  
  -- Get or create district code
  district_code := get_or_create_district_code(state_code, school_district);
  
  -- Get or create school code
  SELECT sc.school_code INTO school_code
  FROM public.school_codes sc
  WHERE sc.school_id = p_school_id;
  
  IF school_code IS NULL THEN
    -- Generate new school code (sequential)
    SELECT LPAD((COALESCE(MAX(school_code::INTEGER), 0) + 1)::TEXT, 3, '0') INTO school_code
    FROM public.school_codes sc2
    WHERE sc2.state_code = state_code AND sc2.district_code = district_code;
    
    -- Insert new school code
    INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
    VALUES (p_school_id, state_code, district_code, school_code);
  END IF;
  
  -- Get class code
  class_code := get_class_code(p_student_class);
  
  IF class_code IS NULL THEN
    RAISE EXCEPTION 'Invalid or unknown class: %', p_student_class;
  END IF;
  
  -- Get next student sequence number for this school, project, and class
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, class_code, 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = public.student_registration_sequences.last_sequence + 1,
    updated_at = now()
  RETURNING last_sequence INTO student_seq;
  
  -- Format student code as 3 digits
  student_code := LPAD(student_seq::TEXT, 3, '0');
  
  -- Build final registration number: subject-state-district-school-class-student
  registration_number := subject_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || LPAD(class_code::TEXT, 2, '0') || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;