-- Update the get_class_code function with new mappings
CREATE OR REPLACE FUNCTION public.get_class_code(student_class text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  CASE UPPER(TRIM(student_class))
    WHEN 'LKG' THEN RETURN 13;
    WHEN 'UKG' THEN RETURN 14;
    WHEN 'CLASS 1', '1' THEN RETURN 1;
    WHEN 'CLASS 2', '2' THEN RETURN 2;
    WHEN 'CLASS 3', '3' THEN RETURN 3;
    WHEN 'CLASS 4', '4' THEN RETURN 4;
    WHEN 'CLASS 5', '5' THEN RETURN 5;
    WHEN 'CLASS 6', '6' THEN RETURN 6;
    WHEN 'CLASS 7', '7' THEN RETURN 7;
    WHEN 'CLASS 8', '8' THEN RETURN 8;
    WHEN 'CLASS 9', '9' THEN RETURN 9;
    WHEN 'CLASS 10', '10' THEN RETURN 10;
    WHEN 'CLASS 11', '11' THEN RETURN 11;
    WHEN 'CLASS 12', '12' THEN RETURN 12;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Update existing sequence data to use new class codes
-- Convert LKG sequences (class_code=9) to class_code=13
UPDATE public.student_registration_sequences 
SET class_code = 13, updated_at = now()
WHERE class_code = 9;

-- Convert UKG sequences (class_code=0) to class_code=14
UPDATE public.student_registration_sequences 
SET class_code = 14, updated_at = now()
WHERE class_code = 0;