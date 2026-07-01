-- Add comprehensive error logging to identify the exact source of ambiguity
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
  RAISE NOTICE 'Step 1: Getting school code for school_id: %', p_school_id;
  BEGIN
    v_school_code := public.get_or_create_school_code(p_school_id);
    RAISE NOTICE 'School code retrieved: %', v_school_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR in get_or_create_school_code: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 2: Getting school state and district';
  BEGIN
    SELECT s.state, s.district 
    INTO v_school_state, v_school_district
    FROM public.schools s
    WHERE s.id = p_school_id;
    RAISE NOTICE 'State: %, District: %', v_school_state, v_school_district;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR getting school details: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 3: Getting state code';
  BEGIN
    SELECT sc.state_code 
    INTO v_state_code
    FROM public.state_codes sc
    WHERE sc.state_name ILIKE v_school_state;
    RAISE NOTICE 'State code: %', v_state_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR getting state code: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 4: Getting district code';  
  BEGIN
    SELECT dc.district_code
    INTO v_district_code
    FROM public.district_codes dc
    WHERE dc.district_name ILIKE v_school_district 
      AND dc.state_code = v_state_code;
    RAISE NOTICE 'District code: %', v_district_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR getting district code: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 5: Getting subject code for subject_id: %', p_subject_id;
  BEGIN
    SELECT os.subject_code 
    INTO v_subject_code
    FROM public.olympiad_subjects os
    WHERE os.id = p_subject_id;
    RAISE NOTICE 'Subject code: %', v_subject_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR getting subject code (AMBIGUITY HERE?): %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 6: Mapping class to code';
  BEGIN
    v_class_code := public.map_student_class_to_code(p_student_class);
    RAISE NOTICE 'Class code: %', v_class_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR in map_student_class_to_code: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 7: Getting student sequence';
  BEGIN
    SELECT COALESCE(srs.last_sequence, 0) + 1
    INTO v_student_sequence
    FROM public.student_registration_sequences srs
    WHERE srs.school_id = p_school_id 
      AND srs.project_id = p_project_id 
      AND srs.class_code = v_class_code;
    
    IF v_student_sequence IS NULL THEN
      v_student_sequence := 1;
    END IF;
    RAISE NOTICE 'Student sequence: %', v_student_sequence;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR getting student sequence: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 8: Updating sequence table';
  BEGIN
    INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
    VALUES (p_school_id, p_project_id, v_class_code, v_student_sequence)
    ON CONFLICT (school_id, project_id, class_code)
    DO UPDATE SET 
      last_sequence = v_student_sequence,
      updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ERROR updating sequence: %', SQLERRM;
  END;
  
  RAISE NOTICE 'Step 9: Building registration number';
  v_registration_number := format(
    '%s-%s-%s-%s-%s-%s',
    v_subject_code,
    lpad(v_state_code, 2, '0'),
    lpad(v_district_code, 3, '0'),
    lpad(v_school_code, 4, '0'),
    lpad(v_class_code::text, 2, '0'),
    lpad(v_student_sequence::text, 3, '0')
  );
  
  RAISE NOTICE 'Final registration number: %', v_registration_number;
  RETURN v_registration_number;
END;
$$;