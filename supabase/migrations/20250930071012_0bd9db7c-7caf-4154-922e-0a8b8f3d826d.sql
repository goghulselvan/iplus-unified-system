-- Drop duplicate/unwanted tables to clean up the database

-- Drop the new states table (keep state_codes)
DROP TABLE IF EXISTS public.states CASCADE;

-- Drop the districts table (keep district_codes) 
DROP TABLE IF EXISTS public.districts CASCADE;

-- Update any functions that might reference the dropped tables
-- Ensure get_or_create_district_code uses district_codes table
CREATE OR REPLACE FUNCTION public.get_or_create_district_code(p_state_code text, p_district_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  existing_code text;
  next_code_num integer;
  new_code text;
BEGIN
  -- Check if district already has a code
  SELECT district_code INTO existing_code
  FROM public.district_codes
  WHERE state_code = p_state_code 
    AND LOWER(TRIM(district_name)) = LOWER(TRIM(p_district_name));
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Get next available district code for this state (3-digit sequential)
  SELECT COALESCE(MAX(CAST(district_code AS integer)), 0) + 1 INTO next_code_num
  FROM public.district_codes
  WHERE state_code = p_state_code
    AND district_code ~ '^\d{3}$';
  
  -- Format as 3-digit code
  new_code := LPAD(next_code_num::text, 3, '0');
  
  -- Insert new district code
  INSERT INTO public.district_codes (state_code, district_name, district_code)
  VALUES (p_state_code, TRIM(p_district_name), new_code)
  ON CONFLICT (state_code, district_name) DO NOTHING;
  
  RETURN new_code;
END;
$$;

-- Update get_or_create_school_code to ensure it uses the correct tables
CREATE OR REPLACE FUNCTION public.get_or_create_school_code(p_state_code text, p_district_code text, p_school_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  existing_code text;
  next_code_num integer;
  new_code text;
BEGIN
  -- Check if school already has a code
  SELECT school_code INTO existing_code
  FROM public.school_codes
  WHERE school_id = p_school_id;
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Get next available school code for this district (5-digit sequential)
  SELECT COALESCE(MAX(CAST(school_code AS integer)), 0) + 1 INTO next_code_num
  FROM public.school_codes
  WHERE state_code = p_state_code
    AND district_code = p_district_code
    AND school_code ~ '^\d{5}$';
  
  -- Format as 5-digit code
  new_code := LPAD(next_code_num::text, 5, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (state_code, district_code, school_id, school_code)
  VALUES (p_state_code, p_district_code, p_school_id, new_code)
  ON CONFLICT (school_id) DO NOTHING;
  
  RETURN new_code;
END;
$$;