-- Fix class code mapping and subject codes to use correct numerical values
-- Update get_class_code function with correct mapping

CREATE OR REPLACE FUNCTION public.get_class_code(p_class text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CASE UPPER(TRIM(p_class))
    WHEN '1' THEN RETURN 01;
    WHEN '2' THEN RETURN 02;
    WHEN '3' THEN RETURN 03;
    WHEN '4' THEN RETURN 04;
    WHEN '5' THEN RETURN 05;
    WHEN '6' THEN RETURN 06;
    WHEN '7' THEN RETURN 07;
    WHEN '8' THEN RETURN 08;
    WHEN '9' THEN RETURN 09;
    WHEN '10' THEN RETURN 10;
    WHEN '11' THEN RETURN 11;
    WHEN '12' THEN RETURN 12;
    WHEN 'LKG' THEN RETURN 14;
    WHEN 'UKG' THEN RETURN 15;
    ELSE RETURN 99;
  END CASE;
END;
$$;

-- Update existing olympiad subjects to use numerical codes
-- English = 1, Maths = 2, Science = 3, GK = 4, Kids = 5
UPDATE public.olympiad_subjects 
SET subject_code = CASE 
  WHEN UPPER(subject_name) LIKE '%ENGLISH%' OR UPPER(subject_name) LIKE '%ENG%' THEN '1'
  WHEN UPPER(subject_name) LIKE '%MATH%' OR UPPER(subject_name) LIKE '%MATHS%' THEN '2'
  WHEN UPPER(subject_name) LIKE '%SCIENCE%' OR UPPER(subject_name) LIKE '%SCI%' THEN '3'
  WHEN UPPER(subject_name) LIKE '%GK%' OR UPPER(subject_name) LIKE '%GENERAL%' THEN '4'
  WHEN UPPER(subject_name) LIKE '%KIDS%' OR UPPER(subject_name) LIKE '%KID%' THEN '5'
  ELSE subject_code
END
WHERE subject_code IS NOT NULL;