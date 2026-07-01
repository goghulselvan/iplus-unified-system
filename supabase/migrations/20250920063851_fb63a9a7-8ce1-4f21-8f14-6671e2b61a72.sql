-- Update the get_class_code function to change LKG from 13 to 14 and UKG from 14 to 15
CREATE OR REPLACE FUNCTION public.get_class_code(student_class text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  CASE UPPER(TRIM(student_class))
    WHEN 'LKG' THEN RETURN 14;  -- Changed from 13 to 14
    WHEN 'UKG' THEN RETURN 15;  -- Changed from 14 to 15
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
$function$