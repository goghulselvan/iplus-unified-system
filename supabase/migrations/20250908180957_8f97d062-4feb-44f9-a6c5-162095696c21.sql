-- Remove the dynamic state code creation function
DROP FUNCTION IF EXISTS public.get_or_create_state_code(text);

-- Update the generate_registration_number function to use predefined state codes only
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
  
  -- Get state code from predefined state_codes table
  SELECT sc.state_code INTO state_code
  FROM public.state_codes sc
  WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(school_state));
  
  -- If state not found in predefined codes, raise error
  IF state_code IS NULL THEN
    RAISE EXCEPTION 'State code not found for state: %. Please ensure the state name matches a predefined state code.', school_state;
  END IF;
  
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

-- Insert all Indian state codes with their official government codes
-- Use DO block to handle existing entries
DO $$
DECLARE
  state_record RECORD;
BEGIN
  -- Array of state data
  FOR state_record IN 
    SELECT * FROM (VALUES
      ('Andhra Pradesh', '28'),
      ('Arunachal Pradesh', '12'),
      ('Assam', '18'),
      ('Bihar', '10'),
      ('Chhattisgarh', '22'),
      ('Goa', '30'),
      ('Gujarat', '24'),
      ('Haryana', '06'),
      ('Himachal Pradesh', '02'),
      ('Jharkhand', '20'),
      ('Karnataka', '29'),
      ('Kerala', '32'),
      ('Madhya Pradesh', '23'),
      ('Maharashtra', '27'),
      ('Manipur', '14'),
      ('Meghalaya', '17'),
      ('Mizoram', '15'),
      ('Nagaland', '13'),
      ('Odisha', '21'),
      ('Punjab', '03'),
      ('Rajasthan', '08'),
      ('Sikkim', '11'),
      ('Tamil Nadu', '33'),
      ('Telangana', '36'),
      ('Tripura', '16'),
      ('Uttar Pradesh', '09'),
      ('Uttarakhand', '05'),
      ('West Bengal', '19'),
      ('Andaman and Nicobar Islands', '35'),
      ('Chandigarh', '04'),
      ('Dadra and Nagar Haveli and Daman and Diu', '26'),
      ('Delhi', '07'),
      ('Jammu and Kashmir', '01'),
      ('Ladakh', '37'),
      ('Lakshadweep', '31'),
      ('Puducherry', '34')
    ) AS states(name, code)
  LOOP
    -- Insert or update each state
    INSERT INTO public.state_codes (state_name, state_code)
    VALUES (state_record.name, state_record.code)
    ON CONFLICT (state_name) DO UPDATE SET 
      state_code = EXCLUDED.state_code;
  END LOOP;
  
  -- If no conflict clause works, try individual inserts
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: individual inserts with existence check
    FOR state_record IN 
      SELECT * FROM (VALUES
        ('Andhra Pradesh', '28'),
        ('Arunachal Pradesh', '12'),
        ('Assam', '18'),
        ('Bihar', '10'),
        ('Chhattisgarh', '22'),
        ('Goa', '30'),
        ('Gujarat', '24'),
        ('Haryana', '06'),
        ('Himachal Pradesh', '02'),
        ('Jharkhand', '20'),
        ('Karnataka', '29'),
        ('Kerala', '32'),
        ('Madhya Pradesh', '23'),
        ('Maharashtra', '27'),
        ('Manipur', '14'),
        ('Meghalaya', '17'),
        ('Mizoram', '15'),
        ('Nagaland', '13'),
        ('Odisha', '21'),
        ('Punjab', '03'),
        ('Rajasthan', '08'),
        ('Sikkim', '11'),
        ('Tamil Nadu', '33'),
        ('Telangana', '36'),
        ('Tripura', '16'),
        ('Uttar Pradesh', '09'),
        ('Uttarakhand', '05'),
        ('West Bengal', '19'),
        ('Andaman and Nicobar Islands', '35'),
        ('Chandigarh', '04'),
        ('Dadra and Nagar Haveli and Daman and Diu', '26'),
        ('Delhi', '07'),
        ('Jammu and Kashmir', '01'),
        ('Ladakh', '37'),
        ('Lakshadweep', '31'),
        ('Puducherry', '34')
      ) AS states(name, code)
    LOOP
      -- Check if state exists, if not insert
      IF NOT EXISTS (SELECT 1 FROM public.state_codes WHERE state_name = state_record.name) THEN
        INSERT INTO public.state_codes (state_name, state_code)
        VALUES (state_record.name, state_record.code);
      ELSE
        -- Update existing
        UPDATE public.state_codes 
        SET state_code = state_record.code 
        WHERE state_name = state_record.name;
      END IF;
    END LOOP;
END $$;