-- Completely rebuild generate_registration_number with maximum SQL clarity
-- to eliminate ALL possible ambiguity issues
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
  -- Step 1: Get or create school code
  v_school_code := public.get_or_create_school_code(p_school_id);
  
  -- Step 2: Get school's state and district (separately to avoid JOIN ambiguity)
  SELECT s.state, s.district 
  INTO v_school_state, v_school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Step 3: Get state code
  SELECT sc.state_code 
  INTO v_state_code
  FROM public.state_codes sc
  WHERE sc.state_name ILIKE v_school_state;
  
  -- Step 4: Get district code  
  SELECT dc.district_code
  INTO v_district_code
  FROM public.district_codes dc
  WHERE dc.district_name ILIKE v_school_district 
    AND dc.state_code = v_state_code;
  
  -- Step 5: Get subject code (with explicit alias)
  SELECT os.subject_code 
  INTO v_subject_code
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  -- Step 6: Map class to code
  v_class_code := public.map_student_class_to_code(p_student_class);
  
  -- Step 7: Get next student sequence
  SELECT COALESCE(srs.last_sequence, 0) + 1
  INTO v_student_sequence
  FROM public.student_registration_sequences srs
  WHERE srs.school_id = p_school_id 
    AND srs.project_id = p_project_id 
    AND srs.class_code = v_class_code;
  
  -- If no sequence exists, start with 1
  IF v_student_sequence IS NULL THEN
    v_student_sequence := 1;
  END IF;
  
  -- Step 8: Update or insert sequence
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, v_class_code, v_student_sequence)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = v_student_sequence,
    updated_at = now();
  
  -- Step 9: Build registration number
  v_registration_number := format(
    '%s-%s-%s-%s-%s-%s',
    v_subject_code,
    lpad(v_state_code, 2, '0'),
    lpad(v_district_code, 3, '0'),
    lpad(v_school_code, 4, '0'),
    lpad(v_class_code::text, 2, '0'),
    lpad(v_student_sequence::text, 3, '0')
  );
  
  RETURN v_registration_number;
END;
$$;