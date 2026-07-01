
-- Fix the ambiguous column reference in build_student_registration_number
-- The issue: variables have the same names as columns, causing ambiguity
CREATE OR REPLACE FUNCTION public.build_student_registration_number(school_uuid uuid, project_uuid uuid, class_name text, subject_uuid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject_code text;
  v_school_number text;
  v_class_number text;
  v_student_number integer;
  v_final_number text;
BEGIN
  -- Get subject code with explicit qualification
  SELECT olympiad_subjects.subject_code 
  INTO v_subject_code
  FROM public.olympiad_subjects
  WHERE olympiad_subjects.id = subject_uuid;
  
  -- Get school SS number
  SELECT schools.ss_no::text 
  INTO v_school_number
  FROM public.schools
  WHERE schools.id = school_uuid;
  
  -- Format class code
  v_class_number := LPAD(map_student_class_to_code(class_name)::text, 2, '0');
  
  -- Get next student sequence
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (school_uuid, project_uuid, map_student_class_to_code(class_name), 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = student_registration_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_student_number;
  
  -- Build registration number: SUBJECT-SCHOOL-CLASS-SEQUENCE
  v_final_number := v_subject_code || '-' || v_school_number || '-' || v_class_number || '-' || LPAD(v_student_number::text, 3, '0');
  
  RETURN v_final_number;
END;
$function$;
