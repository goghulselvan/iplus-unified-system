-- Update get_subject_code function to handle the actual subject names in the database
CREATE OR REPLACE FUNCTION public.get_subject_code(p_subject_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  subject_name text;
BEGIN
  SELECT UPPER(TRIM(os.subject_name)) INTO subject_name
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  IF subject_name IS NULL THEN
    RETURN NULL;
  END IF;
  
  CASE subject_name
    WHEN 'KIDS PLUS OLYMPIAD' THEN RETURN 0;
    WHEN 'ENGLISH PLUS OLYMPIAD' THEN RETURN 1;
    WHEN 'MATHS PLUS OLYMPIAD' THEN RETURN 2;
    WHEN 'SCIENCE PLUS OLYMPIAD' THEN RETURN 3;
    WHEN 'GK PLUS OLYMPIAD' THEN RETURN 4;
    -- Keep the old mappings for backward compatibility
    WHEN 'KIDS' THEN RETURN 0;
    WHEN 'ENGLISH' THEN RETURN 1;
    WHEN 'MATHS', 'MATHEMATICS' THEN RETURN 2;
    WHEN 'SCIENCE' THEN RETURN 3;
    WHEN 'GK', 'GENERAL KNOWLEDGE' THEN RETURN 4;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Now update the test registration with proper subject code
UPDATE student_registrations 
SET registration_number_generated = generate_registration_number(
  school_id, 
  project_id, 
  student_class,
  (SELECT subject_id FROM student_subjects WHERE registration_id = student_registrations.id LIMIT 1)
)
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90';