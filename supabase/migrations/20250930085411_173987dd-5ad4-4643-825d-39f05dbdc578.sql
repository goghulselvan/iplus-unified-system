-- Update the map_student_class_to_code function with new class code mappings
CREATE OR REPLACE FUNCTION public.map_student_class_to_code(class_name text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  CASE UPPER(TRIM(class_name))
    WHEN 'LKG' THEN RETURN 14;
    WHEN 'UKG' THEN RETURN 15;
    WHEN '1' THEN RETURN 1;
    WHEN '2' THEN RETURN 2;
    WHEN '3' THEN RETURN 3;
    WHEN '4' THEN RETURN 4;
    WHEN '5' THEN RETURN 5;
    WHEN '6' THEN RETURN 6;
    WHEN '7' THEN RETURN 7;
    WHEN '8' THEN RETURN 8;
    WHEN '9' THEN RETURN 9;
    WHEN '10' THEN RETURN 10;
    WHEN '11' THEN RETURN 11;
    WHEN '12' THEN RETURN 12;
    ELSE RETURN 99;
  END CASE;
END;
$function$