-- Fix registration number generation to include state and district codes
-- This updates the function to generate: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT

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
  subject_code text;
  state_code text;
  district_code text;
  school_ss_no text;
  class_code text;
  student_seq integer;
  registration_number text;
BEGIN
  -- Get subject code
  SELECT os.subject_code INTO subject_code
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  -- Get state and district codes from school
  SELECT 
    COALESCE(sc.state_code, '00') as state_code,
    COALESCE(sc.district_code, '000') as district_code,
    s.ss_no::text as school_ss_no
  INTO state_code, district_code, school_ss_no
  FROM public.schools s
  LEFT JOIN public.school_codes sc ON s.id = sc.school_id
  WHERE s.id = p_school_id;
  
  -- If no school codes found, try to get from state/district tables
  IF state_code = '00' OR district_code = '000' THEN
    SELECT 
      COALESCE(st.state_code, '00') as state_code,
      COALESCE(dt.district_code, '000') as district_code
    INTO state_code, district_code
    FROM public.schools s
    LEFT JOIN public.states st ON s.state = st.state_name
    LEFT JOIN public.districts dt ON s.district = dt.district_name
    WHERE s.id = p_school_id;
  END IF;
  
  -- Ensure default values if still null
  state_code := COALESCE(state_code, '00');
  district_code := COALESCE(district_code, '000');
  school_ss_no := COALESCE(school_ss_no, '00000');
  
  -- Format class code (2 digits)
  class_code := LPAD(get_class_code(p_student_class)::text, 2, '0');
  
  -- Get next student sequence for this school/project/class
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, get_class_code(p_student_class), 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = student_registration_sequences.last_sequence + 1
  RETURNING last_sequence INTO student_seq;
  
  -- Build registration number: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  registration_number := subject_code || '-' || 
                        LPAD(state_code, 2, '0') || '-' || 
                        LPAD(district_code, 3, '0') || '-' || 
                        LPAD(school_ss_no, 5, '0') || '-' || 
                        class_code || '-' || 
                        LPAD(student_seq::text, 3, '0');
  
  RETURN registration_number;
END;
$$;