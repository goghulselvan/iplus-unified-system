-- Fix school code generation to use 3 digits and handle missing state/district
-- This fixes the "000" school code issue

CREATE OR REPLACE FUNCTION public.get_or_create_school_code(p_school_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_code text;
  v_new_code text;
  v_max_code_num integer;
  v_school_state text;
  v_school_district text;
  v_state_code_var text;
  v_district_code_var text;
BEGIN
  -- Check if school code already exists
  SELECT sc.school_code INTO v_existing_code 
  FROM public.school_codes sc 
  WHERE sc.school_id = p_school_id;
  
  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;
  
  -- Get school details
  SELECT s.state, s.district 
  INTO v_school_state, v_school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
  -- Validate school has state and district
  IF v_school_state IS NULL OR v_school_state = '' THEN
    RAISE EXCEPTION 'School with ID % has no state assigned. Cannot generate school code.', p_school_id;
  END IF;
  
  IF v_school_district IS NULL OR v_school_district = '' THEN
    RAISE EXCEPTION 'School with ID % has no district assigned. Cannot generate school code.', p_school_id;
  END IF;
  
  -- Get state code
  SELECT sc.state_code INTO v_state_code_var
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(v_school_state));
  
  IF v_state_code_var IS NULL THEN
    RAISE EXCEPTION 'State code not found for state: %. Please add this state to state_codes table first.', v_school_state;
  END IF;
  
  -- Get or create district code
  v_district_code_var := public.get_or_create_district_code(v_state_code_var, v_school_district);
  
  IF v_district_code_var IS NULL OR v_district_code_var = '' THEN
    RAISE EXCEPTION 'Failed to get district code for district: % in state: %', v_school_district, v_school_state;
  END IF;
  
  -- Generate new school code (3 digits, sequential within district)
  -- Start from 1 for each district
  SELECT COALESCE(MAX(CAST(sc2.school_code AS integer)), 0) + 1 
  INTO v_max_code_num
  FROM public.school_codes sc2
  WHERE sc2.state_code = v_state_code_var 
    AND sc2.district_code = v_district_code_var;
  
  -- Check if we've exceeded 999 schools (3 digit limit)
  IF v_max_code_num > 999 THEN
    RAISE EXCEPTION 'Maximum number of schools (999) reached for district % in state %', v_school_district, v_school_state;
  END IF;
  
  -- Pad to 3 digits
  v_new_code := LPAD(v_max_code_num::text, 3, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, v_state_code_var, v_district_code_var, v_new_code);
  
  RETURN v_new_code;
END;
$$;