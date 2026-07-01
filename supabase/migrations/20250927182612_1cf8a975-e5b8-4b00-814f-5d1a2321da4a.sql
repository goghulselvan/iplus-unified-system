-- Create missing functions for registration number generation

-- Function to get class code from student class
CREATE OR REPLACE FUNCTION public.get_class_code(p_student_class text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public'
AS $$
BEGIN
  -- Convert class names to numeric codes for registration numbers
  CASE UPPER(TRIM(p_student_class))
    WHEN '1', 'CLASS 1', 'I' THEN RETURN 1;
    WHEN '2', 'CLASS 2', 'II' THEN RETURN 2;
    WHEN '3', 'CLASS 3', 'III' THEN RETURN 3;
    WHEN '4', 'CLASS 4', 'IV' THEN RETURN 4;
    WHEN '5', 'CLASS 5', 'V' THEN RETURN 5;
    WHEN '6', 'CLASS 6', 'VI' THEN RETURN 6;
    WHEN '7', 'CLASS 7', 'VII' THEN RETURN 7;
    WHEN '8', 'CLASS 8', 'VIII' THEN RETURN 8;
    WHEN '9', 'CLASS 9', 'IX' THEN RETURN 9;
    WHEN '10', 'CLASS 10', 'X' THEN RETURN 10;
    WHEN '11', 'CLASS 11', 'XI' THEN RETURN 11;
    WHEN '12', 'CLASS 12', 'XII' THEN RETURN 12;
    WHEN 'UKG', 'UPPER KG' THEN RETURN 14;
    WHEN 'LKG', 'LOWER KG' THEN RETURN 15;
    WHEN 'NURSERY', 'PRE-K' THEN RETURN 16;
    ELSE RETURN 99; -- Default for unknown classes
  END CASE;
END;
$$;

-- Function to assign school codes sequentially within district
CREATE OR REPLACE FUNCTION public.assign_school_code(p_school_id uuid, p_state_code text, p_district_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  existing_code text;
  next_code integer;
  new_school_code text;
BEGIN
  -- Check if school already has a code
  SELECT school_code INTO existing_code
  FROM public.school_codes
  WHERE school_id = p_school_id
    AND state_code = p_state_code
    AND district_code = p_district_code;
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Get next available code for this district
  SELECT COALESCE(MAX(school_code::integer), 0) + 1 INTO next_code
  FROM public.school_codes
  WHERE state_code = p_state_code
    AND district_code = p_district_code
    AND school_code ~ '^[0-9]+$'; -- Only numeric codes
  
  -- Format as 3-digit code
  new_school_code := LPAD(next_code::text, 3, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, p_state_code, p_district_code, new_school_code);
  
  RETURN new_school_code;
END;
$$;

-- Function to get next student sequence for alphabetical ordering
CREATE OR REPLACE FUNCTION public.get_next_student_sequence(p_school_id uuid, p_project_id uuid, p_class_code integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_sequence integer;
BEGIN
  -- Get current sequence for this school/project/class combination
  SELECT COALESCE(last_sequence, 0) INTO current_sequence
  FROM public.student_registration_sequences
  WHERE school_id = p_school_id
    AND project_id = p_project_id
    AND class_code = p_class_code;
  
  -- If no sequence exists, start from 1
  IF current_sequence IS NULL THEN
    current_sequence := 0;
  END IF;
  
  -- Increment sequence
  current_sequence := current_sequence + 1;
  
  -- Update or insert sequence record
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, p_class_code, current_sequence)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = current_sequence,
    updated_at = now();
  
  RETURN current_sequence;
END;
$$;

-- Update the generate_registration_number function to support alphabetical ordering with student name
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid, 
  p_project_id uuid, 
  p_student_class text,
  p_subject_id uuid DEFAULT NULL,
  p_student_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  year_code TEXT := '0'; -- Always use "0" instead of project year
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  student_code TEXT;
  registration_number TEXT;
  school_state TEXT;
  school_district TEXT;
  subject_code INTEGER;
BEGIN
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
  
  -- Get subject code if provided (for new format)
  IF p_subject_id IS NOT NULL THEN
    subject_code := get_subject_code(p_subject_id);
    -- If subject code not found, use 0 as default
    IF subject_code IS NULL THEN
      subject_code := 0;
    END IF;
  END IF;
  
  -- Get next student sequence (this ensures alphabetical ordering when called in sequence)
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- Format student code (class_code + 3-digit sequence)
  student_code := class_code::TEXT || LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number based on format
  IF p_subject_id IS NOT NULL THEN
    -- New format: SUBJECT-STATE-DISTRICT-SCHOOL-STUDENT
    registration_number := subject_code::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  ELSE
    -- Legacy format: 0-STATE-DISTRICT-SCHOOL-STUDENT
    registration_number := year_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  END IF;
  
  RETURN registration_number;
END;
$$;