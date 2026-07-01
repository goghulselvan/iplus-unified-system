-- Fix search path security issues for the functions I just created
CREATE OR REPLACE FUNCTION public.get_class_code(student_class text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  CASE UPPER(TRIM(student_class))
    WHEN 'LKG' THEN RETURN 9;
    WHEN 'UKG' THEN RETURN 0;
    WHEN 'CLASS 1', '1' THEN RETURN 1;
    WHEN 'CLASS 2', '2' THEN RETURN 2;
    WHEN 'CLASS 3', '3' THEN RETURN 3;
    WHEN 'CLASS 4', '4' THEN RETURN 4;
    WHEN 'CLASS 5', '5' THEN RETURN 5;
    WHEN 'CLASS 6', '6' THEN RETURN 6;
    WHEN 'CLASS 7', '7' THEN RETURN 7;
    WHEN 'CLASS 8', '8' THEN RETURN 8;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Fix search path for get_subject_code function
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
    WHEN 'KIDS' THEN RETURN 0;
    WHEN 'ENGLISH' THEN RETURN 1;
    WHEN 'MATHS', 'MATHEMATICS' THEN RETURN 2;
    WHEN 'SCIENCE' THEN RETURN 3;
    WHEN 'GK', 'GENERAL KNOWLEDGE' THEN RETURN 4;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;