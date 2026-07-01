-- Update get_class_code function to use new class codes
CREATE OR REPLACE FUNCTION public.get_class_code(p_student_class text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public'
AS $function$
BEGIN
  CASE UPPER(TRIM(p_student_class))
    WHEN 'LKG', 'L.K.G', 'LOWER KG', 'LOWER KINDERGARTEN' THEN RETURN 14;
    WHEN 'UKG', 'U.K.G', 'UPPER KG', 'UPPER KINDERGARTEN' THEN RETURN 15;
    WHEN 'CLASS 1', 'CLASS I', '1', 'I' THEN RETURN 1;
    WHEN 'CLASS 2', 'CLASS II', '2', 'II' THEN RETURN 2;
    WHEN 'CLASS 3', 'CLASS III', '3', 'III' THEN RETURN 3;
    WHEN 'CLASS 4', 'CLASS IV', '4', 'IV' THEN RETURN 4;
    WHEN 'CLASS 5', 'CLASS V', '5', 'V' THEN RETURN 5;
    WHEN 'CLASS 6', 'CLASS VI', '6', 'VI' THEN RETURN 6;
    WHEN 'CLASS 7', 'CLASS VII', '7', 'VII' THEN RETURN 7;
    WHEN 'CLASS 8', 'CLASS VIII', '8', 'VIII' THEN RETURN 8;
    WHEN 'CLASS 9', 'CLASS IX', '9', 'IX' THEN RETURN 9;
    WHEN 'CLASS 10', 'CLASS X', '10', 'X' THEN RETURN 10;
    WHEN 'CLASS 11', 'CLASS XI', '11', 'XI' THEN RETURN 11;
    WHEN 'CLASS 12', 'CLASS XII', '12', 'XII' THEN RETURN 12;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Create function to assign alphabetical school codes
CREATE OR REPLACE FUNCTION public.assign_alphabetical_school_codes_for_district(p_state_code text, p_district_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  school_record RECORD;
  current_code INTEGER := 1;
BEGIN
  -- First, assign codes to schools that already have student registrations (alphabetical order)
  FOR school_record IN
    SELECT DISTINCT s.id, s.school_name
    FROM public.schools s
    INNER JOIN public.student_registrations sr ON s.id = sr.school_id
    WHERE s.state IN (SELECT state_name FROM public.state_codes WHERE state_code = p_state_code)
    AND s.district IN (SELECT district_name FROM public.district_codes WHERE state_code = p_state_code AND district_code = p_district_code)
    ORDER BY UPPER(TRIM(s.school_name))
  LOOP
    -- Insert or update school code
    INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
    VALUES (school_record.id, p_state_code, p_district_code, LPAD(current_code::text, 3, '0'))
    ON CONFLICT (school_id)
    DO UPDATE SET 
      state_code = p_state_code,
      district_code = p_district_code,
      school_code = LPAD(current_code::text, 3, '0'),
      assigned_at = now();
    
    current_code := current_code + 1;
  END LOOP;
  
  -- Update the district's next available code for new schools
  -- This will be used when new schools get students
END;
$function$;

-- Create function to get alphabetical student sequence
CREATE OR REPLACE FUNCTION public.get_alphabetical_student_sequence(p_school_id uuid, p_project_id uuid, p_class_code integer, p_subject_id uuid, p_student_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  student_sequence INTEGER;
BEGIN
  -- Get the alphabetical position of this student within the school+class+subject combination
  SELECT (ROW_NUMBER() OVER (ORDER BY UPPER(TRIM(sr.student_name))))::integer INTO student_sequence
  FROM public.student_registrations sr
  INNER JOIN public.student_subjects ss ON sr.id = ss.registration_id
  WHERE sr.school_id = p_school_id
    AND sr.project_id = p_project_id
    AND sr.class_code = p_class_code
    AND ss.subject_id = p_subject_id
    AND UPPER(TRIM(sr.student_name)) = UPPER(TRIM(p_student_name));
  
  -- If no sequence found, calculate what it would be
  IF student_sequence IS NULL THEN
    SELECT COUNT(*) + 1 INTO student_sequence
    FROM public.student_registrations sr
    INNER JOIN public.student_subjects ss ON sr.id = ss.registration_id
    WHERE sr.school_id = p_school_id
      AND sr.project_id = p_project_id
      AND sr.class_code = p_class_code
      AND ss.subject_id = p_subject_id
      AND UPPER(TRIM(sr.student_name)) < UPPER(TRIM(p_student_name));
    
    -- Add 1 to get the position this student should occupy
    student_sequence := COALESCE(student_sequence, 1);
  END IF;
  
  RETURN student_sequence;
END;
$function$;

-- Update generate_registration_number function with new format
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text, p_subject_id uuid, p_student_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
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
  formatted_class_code TEXT;
BEGIN
  -- Get subject code
  subject_code := get_subject_code(p_subject_id);
  IF subject_code IS NULL THEN
    RAISE EXCEPTION 'Invalid subject ID: %', p_subject_id;
  END IF;
  
  -- Get school's state and district
  SELECT s.state, s.district INTO school_state, school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Get state code from predefined state_codes table
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(school_state));
  
  IF state_code IS NULL THEN
    RAISE EXCEPTION 'State code not found for state: %. Please ensure the state name matches a predefined state code.', school_state;
  END IF;
  
  -- Get or create district code dynamically
  district_code := get_or_create_district_code(state_code, school_district);
  
  -- Get or assign school code (alphabetically)
  SELECT sc.school_code INTO school_code
  FROM public.school_codes sc
  WHERE sc.school_id = p_school_id;
  
  IF school_code IS NULL THEN
    -- Assign alphabetical codes for this district first
    PERFORM assign_alphabetical_school_codes_for_district(state_code, district_code);
    
    -- Try to get the school code again
    SELECT sc.school_code INTO school_code
    FROM public.school_codes sc
    WHERE sc.school_id = p_school_id;
    
    IF school_code IS NULL THEN
      -- If still null, this school doesn't have students yet, assign next available code
      school_code := assign_school_code(p_school_id, state_code, district_code);
    END IF;
  END IF;
  
  -- Get class code
  class_code := get_class_code(p_student_class);
  IF class_code IS NULL THEN
    RAISE EXCEPTION 'Invalid student class: %', p_student_class;
  END IF;
  
  -- Format class code as 2-digit
  formatted_class_code := LPAD(class_code::TEXT, 2, '0');
  
  -- Get alphabetical student sequence (only if student name is provided)
  IF p_student_name IS NOT NULL THEN
    student_seq := get_alphabetical_student_sequence(p_school_id, p_project_id, class_code, p_subject_id, p_student_name);
  ELSE
    -- Fallback to 1 if no student name provided
    student_seq := 1;
  END IF;
  
  -- Generate final registration number: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  registration_number := subject_code::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || formatted_class_code || '-' || LPAD(student_seq::TEXT, 3, '0');
  
  RETURN registration_number;
END;
$function$;

-- Update the auto_generate_registration_number trigger function
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
        subject_id,
        NEW.student_name
      );
    END IF;
    
    -- Also set the class_code for consistency
    NEW.class_code := get_class_code(NEW.student_class);
  END IF;
  
  RETURN NEW;
END;
$function$;