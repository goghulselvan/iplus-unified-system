-- Fix the school code generation to use 3-digit codes instead of 5-digit
-- Also create the missing trigger for auto-generating registration numbers

-- Update the school code generation function to use 3-digit codes
CREATE OR REPLACE FUNCTION public.get_or_create_school_code(p_school_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  existing_code text;
  new_code text;
  max_code_num integer;
  school_state text;
  school_district text;
  state_code text;
  district_code text;
BEGIN
  -- Check if school code already exists
  SELECT sc.school_code INTO existing_code 
  FROM public.school_codes sc 
  WHERE sc.school_id = p_school_id;
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
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
  
  -- Generate new school code (3 digits, sequential within district)
  SELECT COALESCE(MAX(CAST(sc.school_code AS integer)), 0) + 1 INTO max_code_num
  FROM public.school_codes sc 
  WHERE sc.state_code = state_code AND sc.district_code = district_code;
  
  -- Check if we've exceeded 999 schools
  IF max_code_num > 999 THEN
    RAISE EXCEPTION 'Maximum number of schools (999) reached for district % in state %', school_district, school_state;
  END IF;
  
  new_code := LPAD(max_code_num::text, 3, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, state_code, district_code, new_code);
  
  RETURN new_code;
END;
$function$;

-- Create the trigger for auto-generating registration numbers
DROP TRIGGER IF EXISTS trigger_auto_generate_registration_number ON public.student_subjects;

CREATE TRIGGER trigger_auto_generate_registration_number
  AFTER INSERT ON public.student_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_registration_number();