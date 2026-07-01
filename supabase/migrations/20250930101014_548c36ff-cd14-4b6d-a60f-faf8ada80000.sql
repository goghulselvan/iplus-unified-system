
-- Change school code from 4 digits to 3 digits in build_student_registration_number
-- Registration numbers will be generated in format: 5-33-038-143-14-001 (for LKG) or 5-33-038-143-15-001 (for UKG)
-- 5 = KidsPO subject code
-- 33 = Tamil Nadu state code
-- 038 = Virudhunagar district code
-- 143 = School code (3 digits, max 999 schools per district)
-- 14 = LKG class code or 15 = UKG class code
-- 001, 002, 003... = Sequential student numbers

CREATE OR REPLACE FUNCTION public.build_student_registration_number(school_uuid uuid, project_uuid uuid, class_name text, subject_uuid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject_code text;
  v_state_code text;
  v_district_code text;
  v_school_code text;
  v_class_code integer;
  v_student_sequence integer;
  v_final_number text;
  v_school_state text;
  v_school_district text;
BEGIN
  -- Get subject code with explicit qualification
  SELECT olympiad_subjects.subject_code 
  INTO v_subject_code
  FROM public.olympiad_subjects
  WHERE olympiad_subjects.id = subject_uuid;
  
  -- Get school state and district
  SELECT schools.state, schools.district
  INTO v_school_state, v_school_district
  FROM public.schools
  WHERE schools.id = school_uuid;
  
  -- Get state code
  SELECT state_codes.state_code 
  INTO v_state_code
  FROM public.state_codes
  WHERE state_codes.state_name ILIKE v_school_state;
  
  -- Get district code
  SELECT district_codes.district_code
  INTO v_district_code
  FROM public.district_codes
  WHERE district_codes.district_name ILIKE v_school_district 
    AND district_codes.state_code = v_state_code;
  
  -- Get or create school code (3 digits)
  v_school_code := public.get_or_create_school_code(school_uuid);
  
  -- Map class to code
  v_class_code := public.map_student_class_to_code(class_name);
  
  -- Get next student sequence
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (school_uuid, project_uuid, v_class_code, 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = student_registration_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_student_sequence;
  
  -- Build registration number in correct format: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  -- Example: 5-33-038-143-14-001
  v_final_number := format(
    '%s-%s-%s-%s-%s-%s',
    v_subject_code,                              -- Subject code (e.g., 5 for KidsPO)
    LPAD(v_state_code, 2, '0'),                 -- State code (2 digits, e.g., 33 for Tamil Nadu)
    LPAD(v_district_code, 3, '0'),              -- District code (3 digits, e.g., 038 for Virudhunagar)
    LPAD(v_school_code, 3, '0'),                -- School code (3 digits, e.g., 143, max 999 per district)
    LPAD(v_class_code::text, 2, '0'),           -- Class code (2 digits, e.g., 14 for LKG, 15 for UKG)
    LPAD(v_student_sequence::text, 3, '0')      -- Student sequence (3 digits, e.g., 001, 002, 003...)
  );
  
  RETURN v_final_number;
END;
$function$;

-- Also update generate_registration_number to use 3 digit school code
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid,
  p_project_id uuid,
  p_student_class text,
  p_subject_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_school_code text;
  v_state_code text;
  v_district_code text;
  v_subject_code text;
  v_class_code integer;
  v_student_sequence integer;
  v_registration_number text;
  v_school_state text;
  v_school_district text;
BEGIN
  -- Get school code
  v_school_code := public.get_or_create_school_code(p_school_id);
  
  -- Get school state and district
  SELECT s.state, s.district 
  INTO v_school_state, v_school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Get state code
  SELECT sc.state_code 
  INTO v_state_code
  FROM public.state_codes sc
  WHERE sc.state_name ILIKE v_school_state;
  
  -- Get district code
  SELECT dc.district_code
  INTO v_district_code
  FROM public.district_codes dc
  WHERE dc.district_name ILIKE v_school_district 
    AND dc.state_code = v_state_code;
  
  -- Get subject code with explicit subquery to eliminate ALL ambiguity
  v_subject_code := (
    SELECT olympiad_subjects.subject_code
    FROM public.olympiad_subjects
    WHERE olympiad_subjects.id = p_subject_id
    LIMIT 1
  );
  
  -- Map class to code
  v_class_code := public.map_student_class_to_code(p_student_class);
  
  -- Get student sequence
  SELECT COALESCE(srs.last_sequence, 0) + 1
  INTO v_student_sequence
  FROM public.student_registration_sequences srs
  WHERE srs.school_id = p_school_id 
    AND srs.project_id = p_project_id 
    AND srs.class_code = v_class_code;
  
  IF v_student_sequence IS NULL THEN
    v_student_sequence := 1;
  END IF;
  
  -- Update sequence
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, v_class_code, v_student_sequence)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = v_student_sequence,
    updated_at = now();
  
  -- Build registration number with 3 digit school code
  v_registration_number := format(
    '%s-%s-%s-%s-%s-%s',
    v_subject_code,
    lpad(v_state_code, 2, '0'),
    lpad(v_district_code, 3, '0'),
    lpad(v_school_code, 3, '0'),              -- Changed to 3 digits
    lpad(v_class_code::text, 2, '0'),
    lpad(v_student_sequence::text, 3, '0')
  );
  
  RETURN v_registration_number;
END;
$$;
