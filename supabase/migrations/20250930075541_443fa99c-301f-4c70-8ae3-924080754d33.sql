-- Drop and recreate the registration number generation function to map 
-- user-friendly subject codes back to numerical codes for compact registration numbers

DROP FUNCTION IF EXISTS public.generate_registration_number(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text, p_subject_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  subject_code text;
  numerical_subject_code text;
  state_code text;
  district_code text;
  school_code text;
  class_code text;
  student_code text;
  school_state text;
  school_district text;
  registration_number text;
  class_code_int integer;
BEGIN
  -- Get subject code (will be EPO, MPO, SPO, GKPO, KidsPO)
  SELECT os.subject_code INTO subject_code
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  -- Map user-friendly codes to numerical codes for compact registration numbers
  CASE subject_code
    WHEN 'EPO' THEN numerical_subject_code := '1';
    WHEN 'MPO' THEN numerical_subject_code := '2';
    WHEN 'SPO' THEN numerical_subject_code := '3';
    WHEN 'GKPO' THEN numerical_subject_code := '4';
    WHEN 'KidsPO' THEN numerical_subject_code := '0';
    ELSE numerical_subject_code := '9'; -- fallback for unknown codes
  END CASE;
  
  -- Get school details
  SELECT s.state, s.district INTO school_state, school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Get state code
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(sc.state_name) = UPPER(school_state);
  
  -- Get or create district code
  district_code := public.get_or_create_district_code(state_code, school_district);
  
  -- Get or create school code (only when namelist is uploaded)
  school_code := public.get_or_create_school_code(p_school_id);
  
  -- Get class code
  class_code_int := public.get_class_code(p_student_class);
  class_code := LPAD(class_code_int::text, 2, '0');
  
  -- Get next student sequence
  student_code := LPAD(public.get_next_student_sequence(p_school_id, class_code_int, p_project_id)::text, 3, '0');
  
  -- Combine all parts using numerical subject code for compact format
  registration_number := numerical_subject_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || class_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;