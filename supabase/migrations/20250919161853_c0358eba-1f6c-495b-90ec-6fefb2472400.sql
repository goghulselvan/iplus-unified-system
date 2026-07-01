-- Clean up district codes for Tamil Nadu
-- Step 1: Update KANNIYAKUMARI (011) and NILGIRIS (018) to proper state (Tamil Nadu)
UPDATE public.district_codes 
SET state_code = '33', district_name = 'KANNIYAKUMARI'
WHERE district_code = '011' AND district_name = 'KANNIYAKUMARI' AND state_code = '19';

UPDATE public.district_codes 
SET state_code = '33', district_name = 'NILGIRIS'
WHERE district_code = '018' AND district_name = 'NILGIRIS' AND state_code = '19';

-- Step 2: Remove duplicate entries in Tamil Nadu (codes 039 and 040)
DELETE FROM public.district_codes 
WHERE state_code = '33' AND district_code IN ('039', '040');

-- Step 3: Remove any other incorrect Nilgiris duplicates in Tamil Nadu
DELETE FROM public.district_codes 
WHERE state_code = '33' 
  AND district_name IN ('Nilgiris', 'THE NILGIRIS') 
  AND district_code != '018';

-- Step 4: Clear school codes for affected schools (they'll be reassigned with correct district codes)
DELETE FROM public.school_codes 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE s.state = 'TAMIL NADU' 
    AND (UPPER(TRIM(s.district)) IN ('KANNIYAKUMARI', 'NILGIRIS', 'THE NILGIRIS'))
);

-- Step 5: Reset student registration sequences (fresh start with new numbering)
DELETE FROM public.student_registration_sequences;

-- Step 6: Update the registration number generation function to new format
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid, 
  p_project_id uuid, 
  p_student_class text, 
  p_subject_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  subject_code INTEGER;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  formatted_class_code TEXT;
  formatted_student_code TEXT;
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
  
  -- Format class code as 2-digit with zero padding
  formatted_class_code := LPAD(class_code::TEXT, 2, '0');
  
  -- Format student sequence as 3-digit with zero padding
  formatted_student_code := LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number: STATE-DISTRICT-SCHOOL-CLASS-STUDENT-SUBJECT
  registration_number := state_code || '-' || district_code || '-' || school_code || '-' || 
                        formatted_class_code || '-' || formatted_student_code || '-' || subject_code::TEXT;
  
  RETURN registration_number;
END;
$$;