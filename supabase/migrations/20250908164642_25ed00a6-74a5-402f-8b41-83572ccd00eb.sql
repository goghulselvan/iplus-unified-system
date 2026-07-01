-- Create state codes table for permanent government codes
CREATE TABLE public.state_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_name TEXT NOT NULL,
  state_code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create district codes table for permanent government codes
CREATE TABLE public.district_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_code TEXT NOT NULL,
  district_name TEXT NOT NULL,
  district_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(state_code, district_code)
);

-- Add registration_number field to student_registrations
ALTER TABLE public.student_registrations 
ADD COLUMN registration_number_generated TEXT,
ADD COLUMN class_code INTEGER;

-- Create school_codes table to track assigned codes per district
CREATE TABLE public.school_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL,
  state_code TEXT NOT NULL,
  district_code TEXT NOT NULL,
  school_code TEXT NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(school_id),
  UNIQUE(state_code, district_code, school_code)
);

-- Create student registration sequences table
CREATE TABLE public.student_registration_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL,
  project_id UUID NOT NULL,
  class_code INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(school_id, project_id, class_code)
);

-- Function to get class code from student class
CREATE OR REPLACE FUNCTION public.get_class_code(student_class TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE UPPER(TRIM(student_class))
    WHEN 'LKG' THEN RETURN 0;
    WHEN 'UKG' THEN RETURN 1;
    WHEN 'CLASS 1', '1' THEN RETURN 2;
    WHEN 'CLASS 2', '2' THEN RETURN 3;
    WHEN 'CLASS 3', '3' THEN RETURN 4;
    WHEN 'CLASS 4', '4' THEN RETURN 5;
    WHEN 'CLASS 5', '5' THEN RETURN 6;
    WHEN 'CLASS 6', '6' THEN RETURN 7;
    WHEN 'CLASS 7', '7' THEN RETURN 8;
    WHEN 'CLASS 8', '8' THEN RETURN 9;
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- Function to assign school code (first come first serve per district)
CREATE OR REPLACE FUNCTION public.assign_school_code(p_school_id UUID, p_state_code TEXT, p_district_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_code TEXT;
  next_code INTEGER;
  new_school_code TEXT;
BEGIN
  -- Check if school already has a code
  SELECT school_code INTO existing_code
  FROM public.school_codes
  WHERE school_id = p_school_id;
  
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Get next available code for this district
  SELECT COALESCE(MAX(school_code::INTEGER), 0) + 1 INTO next_code
  FROM public.school_codes
  WHERE state_code = p_state_code AND district_code = p_district_code;
  
  -- Format as 3-digit code
  new_school_code := LPAD(next_code::TEXT, 3, '0');
  
  -- Insert new school code
  INSERT INTO public.school_codes (school_id, state_code, district_code, school_code)
  VALUES (p_school_id, p_state_code, p_district_code, new_school_code);
  
  RETURN new_school_code;
END;
$$;

-- Function to generate next student sequence (alphabetical within class)
CREATE OR REPLACE FUNCTION public.get_next_student_sequence(p_school_id UUID, p_project_id UUID, p_class_code INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  -- Get or create sequence for this school/project/class
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (p_school_id, p_project_id, p_class_code, 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET 
    last_sequence = student_registration_sequences.last_sequence + 1,
    updated_at = now()
  RETURNING last_sequence INTO next_seq;
  
  RETURN next_seq;
END;
$$;

-- Function to generate full registration number
CREATE OR REPLACE FUNCTION public.generate_registration_number(
  p_school_id UUID,
  p_project_id UUID,
  p_student_class TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  project_year INTEGER;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  student_code TEXT;
  registration_number TEXT;
BEGIN
  -- Get project year
  SELECT project_year INTO project_year
  FROM public.olympiad_projects
  WHERE id = p_project_id;
  
  -- Get school's state and district codes (you'll need to map these)
  -- For now, using placeholder logic - you'll need to implement proper mapping
  SELECT 
    CASE 
      WHEN state = 'TAMIL NADU' THEN '33'
      ELSE '00'
    END,
    LPAD(ROW_NUMBER() OVER (PARTITION BY state ORDER BY district)::TEXT, 3, '0')
  INTO state_code, district_code
  FROM public.schools
  WHERE id = p_school_id;
  
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
  
  -- Generate final registration number
  registration_number := project_year::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || student_code;
  
  RETURN registration_number;
END;
$$;

-- Add RLS policies for new tables
ALTER TABLE public.state_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.district_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_registration_sequences ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Managers can view state codes" ON public.state_codes FOR SELECT USING (is_manager_or_superadmin());
CREATE POLICY "Superadmins can manage state codes" ON public.state_codes FOR ALL USING (is_superadmin_with_ip_check());

CREATE POLICY "Managers can view district codes" ON public.district_codes FOR SELECT USING (is_manager_or_superadmin());
CREATE POLICY "Superadmins can manage district codes" ON public.district_codes FOR ALL USING (is_superadmin_with_ip_check());

CREATE POLICY "Managers can view school codes" ON public.school_codes FOR SELECT USING (is_manager_or_superadmin());
CREATE POLICY "System can manage school codes" ON public.school_codes FOR ALL USING (true);

CREATE POLICY "Managers can view sequences" ON public.student_registration_sequences FOR SELECT USING (is_manager_or_superadmin());
CREATE POLICY "System can manage sequences" ON public.student_registration_sequences FOR ALL USING (true);

-- Add indexes for performance
CREATE INDEX idx_student_registrations_registration_number ON public.student_registrations(registration_number_generated);
CREATE INDEX idx_school_codes_lookup ON public.school_codes(state_code, district_code);
CREATE INDEX idx_student_sequences_lookup ON public.student_registration_sequences(school_id, project_id, class_code);

-- Add trigger to automatically update updated_at
CREATE TRIGGER update_student_registration_sequences_updated_at
  BEFORE UPDATE ON public.student_registration_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();