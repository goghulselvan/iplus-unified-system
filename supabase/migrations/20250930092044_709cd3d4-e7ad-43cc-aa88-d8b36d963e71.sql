-- Fix the SQL ambiguity in generate_registration_number function
-- The issue is likely in JOIN queries where subject_code appears in multiple tables
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid,
  p_project_id uuid,
  p_student_class text,
  p_subject_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  school_code_var text;
  state_code_var text;
  district_code_var text;
  subject_code_var text;
  class_code_var integer;
  student_sequence integer;
  registration_number text;
BEGIN
  -- Get or create school codes
  school_code_var := get_or_create_school_code(p_school_id);
  
  -- Get state and district codes from school
  SELECT 
    sc.state_code,
    dc.district_code
  INTO state_code_var, district_code_var
  FROM public.schools s
  LEFT JOIN public.state_codes sc ON sc.state_name ILIKE s.state
  LEFT JOIN public.district_codes dc ON dc.district_name ILIKE s.district AND dc.state_code = sc.state_code
  WHERE s.id = p_school_id;
  
  -- Get subject code (fix ambiguity by using table alias)
  SELECT os.subject_code INTO subject_code_var
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  -- Map class to code
  class_code_var := map_student_class_to_code(p_student_class);
  
  -- Get next student sequence for this school+project+class combination
  SELECT 
    COALESCE(srs.last_sequence, 0) + 1
  INTO student_sequence
  FROM public.student_registration_sequences srs
  WHERE srs.school_id = p_school_id 
    AND srs.project_id = p_project_id 
    AND srs.class_code = class_code_var;
  
  -- If no sequence exists, start with 1
  IF student_sequence IS NULL THEN
    student_sequence := 1;
  END IF;
  
  -- Update or insert sequence
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, class_code_var, student_sequence)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = student_sequence,
    updated_at = now();
  
  -- Build registration number: subject-state-district-school-class-student
  registration_number := format(
    '%s-%s-%s-%s-%s-%s',
    subject_code_var,
    lpad(state_code_var, 2, '0'),
    lpad(district_code_var, 3, '0'),
    lpad(school_code_var, 4, '0'),
    lpad(class_code_var::text, 2, '0'),
    lpad(student_sequence::text, 3, '0')
  );
  
  RETURN registration_number;
END;
$$;