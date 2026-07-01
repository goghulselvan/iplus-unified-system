-- Fix the alphabetical school code assignment function
CREATE OR REPLACE FUNCTION public.assign_alphabetical_school_codes_for_district(p_state_code text, p_district_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  school_record RECORD;
  current_code INTEGER := 1;
BEGIN
  -- First, assign codes to schools that already have student registrations (alphabetical order)
  FOR school_record IN
    SELECT DISTINCT s.id, s.school_name
    FROM public.schools s
    INNER JOIN public.student_registrations sr ON s.id = sr.school_id
    WHERE s.state IN (SELECT state_name FROM public.state_codes WHERE state_code = p_state_code)
    AND s.district IN (SELECT district_name FROM public.district_codes WHERE state_code = p_state_code AND district_code = p_district_code)
    ORDER BY s.school_name -- Remove UPPER(TRIM()) from ORDER BY since it's not in SELECT
  LOOP
    -- Insert or update school code
    INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
    VALUES (school_record.id, p_state_code, p_district_code, LPAD(current_code::text, 3, '0'))
    ON CONFLICT (school_id)
    DO UPDATE SET 
      state_code = p_state_code,
      district_code = p_district_code,
      school_code = LPAD(current_code::text, 3, '0'),
      assigned_at = now();
    
    current_code := current_code + 1;
  END LOOP;
END;
$function$;