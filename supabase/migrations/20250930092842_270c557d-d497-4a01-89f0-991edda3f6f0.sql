-- Fix ALL functions to eliminate any possible SQL ambiguity
-- Fix get_or_create_school_code function
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
  
  -- Get state code
  SELECT sc.state_code INTO v_state_code_var
  FROM public.state_codes sc
  WHERE UPPER(sc.state_name) = UPPER(v_school_state);
  
  -- Get or create district code
  v_district_code_var := public.get_or_create_district_code(v_state_code_var, v_school_district);
  
  -- Generate new school code (4 digits, sequential within district)
  SELECT COALESCE(MAX(CAST(sc2.school_code AS integer)), 0) + 1 
  INTO v_max_code_num
  FROM public.school_codes sc2
  WHERE sc2.state_code = v_state_code_var 
    AND sc2.district_code = v_district_code_var;
  
  -- Check if we've exceeded 9999 schools
  IF v_max_code_num > 9999 THEN
    RAISE EXCEPTION 'Maximum number of schools (9999) reached for district % in state %', v_school_district, v_school_state;
  END IF;
  
  v_new_code := LPAD(v_max_code_num::text, 4, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, v_state_code_var, v_district_code_var, v_new_code);
  
  RETURN v_new_code;
END;
$$;

-- Also ensure get_or_create_district_code is explicit
CREATE OR REPLACE FUNCTION public.get_or_create_district_code(p_state_code text, p_district_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_code text;
  v_next_code_num integer;
  v_new_code text;
BEGIN
  -- Check if district already has a code
  SELECT dc.district_code INTO v_existing_code
  FROM public.district_codes dc
  WHERE dc.state_code = p_state_code 
    AND LOWER(TRIM(dc.district_name)) = LOWER(TRIM(p_district_name));
  
  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;
  
  -- Get next available district code for this state (3-digit sequential)
  SELECT COALESCE(MAX(CAST(dc2.district_code AS integer)), 0) + 1 
  INTO v_next_code_num
  FROM public.district_codes dc2
  WHERE dc2.state_code = p_state_code
    AND dc2.district_code ~ '^\d{3}$';
  
  -- Format as 3-digit code
  v_new_code := LPAD(v_next_code_num::text, 3, '0');
  
  -- Insert new district code
  INSERT INTO public.district_codes (state_code, district_name, district_code)
  VALUES (p_state_code, TRIM(p_district_name), v_new_code)
  ON CONFLICT (state_code, district_name) DO NOTHING;
  
  RETURN v_new_code;
END;
$$;