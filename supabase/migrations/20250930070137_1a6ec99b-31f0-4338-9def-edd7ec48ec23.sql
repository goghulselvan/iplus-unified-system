-- Drop existing function with correct signature
DROP FUNCTION IF EXISTS public.generate_registration_number(uuid, uuid, text, uuid);

-- Complete registration number system implementation

-- Function to get or create district code
CREATE OR REPLACE FUNCTION public.get_or_create_district_code(p_state_code text, p_district_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_code text;
  new_code text;
  max_code_num integer;
BEGIN
  -- Check if district code already exists
  SELECT district_code INTO existing_code 
  FROM public.district_codes 
  WHERE state_code = p_state_code AND district_name = UPPER(TRIM(p_district_name));
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Generate new district code (3 digits, sequential within state)
  SELECT COALESCE(MAX(CAST(district_code AS integer)), 0) + 1 INTO max_code_num
  FROM public.district_codes 
  WHERE state_code = p_state_code;
  
  new_code := LPAD(max_code_num::text, 3, '0');
  
  -- Insert new district code
  INSERT INTO public.district_codes (state_code, district_name, district_code)
  VALUES (p_state_code, UPPER(TRIM(p_district_name)), new_code);
  
  RETURN new_code;
END;
$$;

-- Function to get or create school code
CREATE OR REPLACE FUNCTION public.get_or_create_school_code(p_school_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  
  -- Generate new school code (5 digits, sequential within district)
  SELECT COALESCE(MAX(CAST(sc.school_code AS integer)), 0) + 1 INTO max_code_num
  FROM public.school_codes sc 
  WHERE sc.state_code = state_code AND sc.district_code = district_code;
  
  new_code := LPAD(max_code_num::text, 5, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, state_code, district_code, new_code);
  
  RETURN new_code;
END;
$$;

-- Function to generate next student sequence number
CREATE OR REPLACE FUNCTION public.get_next_student_sequence(p_school_id uuid, p_class_code integer, p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_seq integer;
BEGIN
  -- Get and increment sequence for this school/class/project combination
  INSERT INTO public.student_registration_sequences (school_id, class_code, project_id, last_sequence)
  VALUES (p_school_id, p_class_code, p_project_id, 1)
  ON CONFLICT (school_id, class_code, project_id)
  DO UPDATE SET 
    last_sequence = student_registration_sequences.last_sequence + 1,
    updated_at = now()
  RETURNING last_sequence INTO next_seq;
  
  RETURN next_seq;
END;
$$;

-- Updated function to generate complete registration number
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id uuid,
  p_subject_id uuid,
  p_student_class text,
  p_project_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  subject_code text;
  state_code text;
  district_code text;
  school_code text;
  class_code text;
  student_code text;
  school_state text;
  school_district text;
  registration_number text;
  class_code_int integer;
BEGIN
  -- Get subject code
  SELECT os.subject_code INTO subject_code
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
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
  
  -- Get or create school code (only when namelist is uploaded)
  school_code := public.get_or_create_school_code(p_school_id);
  
  -- Get class code
  class_code_int := public.get_class_code(p_student_class);
  class_code := LPAD(class_code_int::text, 2, '0');
  
  -- Get next student sequence
  student_code := LPAD(public.get_next_student_sequence(p_school_id, class_code_int, p_project_id)::text, 3, '0');
  
  -- Combine all parts
  registration_number := subject_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || class_code || '-' || student_code;
  
  RETURN registration_number;
END;
$$;

-- Add unique constraint to student_registration_sequences if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'unique_school_class_project' 
        AND table_name = 'student_registration_sequences'
    ) THEN
        ALTER TABLE public.student_registration_sequences 
        ADD CONSTRAINT unique_school_class_project 
        UNIQUE (school_id, class_code, project_id);
    END IF;
END $$;