-- Update school code generation to use 3 digits and fix bulk upload format

-- First update any existing database function that generates school codes
-- The school code should be 3 digits (001-999) instead of 5 digits

-- Also create a function to handle the new bulk upload format
-- Each row in CSV should create a separate registration (Student Name, Class, Olympiad)

CREATE OR REPLACE FUNCTION public.get_next_school_code(p_district_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  next_school_code text;
  max_school_code integer;
BEGIN
  -- Get the highest school code for this district (3 digits: 001-999)
  SELECT COALESCE(MAX(school_code::integer), 0) INTO max_school_code
  FROM public.school_codes
  WHERE district_code = p_district_code;
  
  -- Increment and format as 3-digit code
  next_school_code := LPAD((max_school_code + 1)::text, 3, '0');
  
  -- Check if we've exceeded 999 schools
  IF (max_school_code + 1) > 999 THEN
    RAISE EXCEPTION 'Maximum number of schools (999) reached for district %', p_district_code;
  END IF;
  
  RETURN next_school_code;
END;
$function$;

-- Function to process bulk upload with new format (Student Name, Class, Olympiad)
CREATE OR REPLACE FUNCTION public.process_bulk_registration_new_format(
  p_school_id uuid,
  p_project_id uuid,
  p_registrations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  registration_record jsonb;
  student_record RECORD;
  subject_record RECORD;
  registration_id uuid;
  result_count integer := 0;
  results jsonb := '[]'::jsonb;
BEGIN
  -- Only managers and superadmins can process bulk registrations
  IF NOT is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Insufficient permissions for bulk registration';
  END IF;

  -- Process each registration entry
  FOR registration_record IN SELECT * FROM jsonb_array_elements(p_registrations)
  LOOP
    -- Find the subject by name or code
    SELECT id INTO subject_record
    FROM public.olympiad_subjects 
    WHERE project_id = p_project_id 
    AND (
      LOWER(subject_name) = LOWER(registration_record->>'olympiad') 
      OR subject_code = registration_record->>'olympiad'
    )
    AND is_active = true
    LIMIT 1;
    
    IF subject_record.id IS NULL THEN
      RAISE EXCEPTION 'Subject not found: %', registration_record->>'olympiad';
    END IF;
    
    -- Create student registration for this specific participation
    INSERT INTO public.student_registrations (
      project_id,
      school_id,
      student_name,
      student_class,
      created_by
    ) VALUES (
      p_project_id,
      p_school_id,
      registration_record->>'student_name',
      registration_record->>'class',
      auth.uid()
    ) RETURNING id INTO registration_id;
    
    -- Create subject association
    INSERT INTO public.student_subjects (
      registration_id,
      subject_id
    ) VALUES (
      registration_id,
      subject_record.id
    );
    
    result_count := result_count + 1;
    results := results || jsonb_build_object(
      'registration_id', registration_id,
      'student_name', registration_record->>'student_name',
      'class', registration_record->>'class',
      'olympiad', registration_record->>'olympiad'
    );
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'registrations_created', result_count,
    'details', results
  );
END;
$function$;