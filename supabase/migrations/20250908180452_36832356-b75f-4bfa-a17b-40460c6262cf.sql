-- Create helper function to get or create state code
CREATE OR REPLACE FUNCTION public.get_or_create_state_code(p_state_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_state_code TEXT;
  next_state_code INTEGER;
  new_state_code TEXT;
BEGIN
  -- Check if state already has a code
  SELECT state_code INTO existing_state_code
  FROM public.state_codes
  WHERE UPPER(TRIM(state_name)) = UPPER(TRIM(p_state_name));
  
  IF existing_state_code IS NOT NULL THEN
    RETURN existing_state_code;
  END IF;
  
  -- Get next available state code (sequential assignment)
  SELECT COALESCE(MAX(state_code::INTEGER), 0) + 1 INTO next_state_code
  FROM public.state_codes
  WHERE state_code ~ '^[0-9]+$'; -- Only numeric state codes
  
  -- Format as 2-digit code
  new_state_code := LPAD(next_state_code::TEXT, 2, '0');
  
  -- Insert new state code
  INSERT INTO public.state_codes (state_name, state_code)
  VALUES (TRIM(p_state_name), new_state_code);
  
  -- Log the creation
  PERFORM public.log_security_action(
    'STATE_CODE_CREATED',
    'state_codes',
    NULL,
    NULL,
    jsonb_build_object(
      'state_name', p_state_name,
      'state_code', new_state_code,
      'created_at', now()
    )
  );
  
  RETURN new_state_code;
END;
$function$;

-- Create helper function to get or create district code
CREATE OR REPLACE FUNCTION public.get_or_create_district_code(p_state_code text, p_district_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_district_code TEXT;
  next_district_code INTEGER;
  new_district_code TEXT;
BEGIN
  -- Check if district already has a code for this state
  SELECT district_code INTO existing_district_code
  FROM public.district_codes
  WHERE state_code = p_state_code 
    AND UPPER(TRIM(district_name)) = UPPER(TRIM(p_district_name));
  
  IF existing_district_code IS NOT NULL THEN
    RETURN existing_district_code;
  END IF;
  
  -- Get next available district code for this state (sequential assignment)
  SELECT COALESCE(MAX(district_code::INTEGER), 0) + 1 INTO next_district_code
  FROM public.district_codes
  WHERE state_code = p_state_code 
    AND district_code ~ '^[0-9]+$'; -- Only numeric district codes
  
  -- Format as 3-digit code
  new_district_code := LPAD(next_district_code::TEXT, 3, '0');
  
  -- Insert new district code
  INSERT INTO public.district_codes (state_code, district_name, district_code)
  VALUES (p_state_code, TRIM(p_district_name), new_district_code);
  
  -- Log the creation
  PERFORM public.log_security_action(
    'DISTRICT_CODE_CREATED',
    'district_codes',
    NULL,
    NULL,
    jsonb_build_object(
      'state_code', p_state_code,
      'district_name', p_district_name,
      'district_code', new_district_code,
      'created_at', now()
    )
  );
  
  RETURN new_district_code;
END;
$function$;

-- Update the generate_registration_number function to use dynamic assignment
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  project_year INTEGER;
  year_code TEXT;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  student_code TEXT;
  registration_number TEXT;
  school_state TEXT;
  school_district TEXT;
BEGIN
  -- Get project year
  SELECT project_year INTO project_year
  FROM public.olympiad_projects
  WHERE id = p_project_id;
  
  -- Convert to last 2 digits (e.g., 2025 -> 25)
  year_code := LPAD((project_year % 100)::TEXT, 2, '0');
  
  -- Get school's state and district
  SELECT state, district INTO school_state, school_district
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Get or create state code dynamically
  state_code := get_or_create_state_code(school_state);
  
  -- Get or create district code dynamically
  district_code := get_or_create_district_code(state_code, school_district);
  
  -- Get or assign school code
  school_code := assign_school_code(p_school_id, state_code, district_code);
  
  -- Get class code
  class_code := get_class_code(p_student_class);
  
  IF class_code IS NULL THEN
    RAISE EXCEPTION 'Invalid student class: %', p_student_class;
  END IF;
  
  -- Get next student sequence
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- Format student code (class_code + 3-digit sequence)
  student_code := class_code::TEXT || LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number: YY-STATE-DISTRICT-SCHOOL-STUDENT
  registration_number := year_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;

-- Clean up existing static Tamil Nadu data (keep only the dynamic assignment system)
-- Remove pre-populated district codes - they will be created dynamically
DELETE FROM public.district_codes 
WHERE state_code = '33' AND district_name IN (
  'Ariyalur', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri', 'Dindigul',
  'Erode', 'Kallakurichi', 'Kanchipuram', 'Kanyakumari', 'Karur', 'Krishnagiri',
  'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris', 'Perambalur',
  'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi',
  'Thanjavur', 'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupathur',
  'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore', 'Viluppuram',
  'Virudhunagar', 'The Nilgiris'
);

-- Update existing Tamil Nadu state entry to ensure consistency
UPDATE public.state_codes 
SET state_name = 'Tamil Nadu'
WHERE state_code = '33';