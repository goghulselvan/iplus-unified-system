-- Drop existing function first
DROP FUNCTION IF EXISTS public.get_class_code(text) CASCADE;

-- Recreate get_class_code function  
CREATE OR REPLACE FUNCTION public.get_class_code(p_student_class text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Convert class name to class code
  CASE UPPER(TRIM(p_student_class))
    WHEN 'LKG', 'LOWER KG', 'PRE-K' THEN RETURN 0;
    WHEN 'UKG', 'UPPER KG', 'K' THEN RETURN 1;
    WHEN 'CLASS 1', '1', 'FIRST', 'I' THEN RETURN 1;
    WHEN 'CLASS 2', '2', 'SECOND', 'II' THEN RETURN 2;
    WHEN 'CLASS 3', '3', 'THIRD', 'III' THEN RETURN 3;
    WHEN 'CLASS 4', '4', 'FOURTH', 'IV' THEN RETURN 4;
    WHEN 'CLASS 5', '5', 'FIFTH', 'V' THEN RETURN 5;
    WHEN 'CLASS 6', '6', 'SIXTH', 'VI' THEN RETURN 6;
    WHEN 'CLASS 7', '7', 'SEVENTH', 'VII' THEN RETURN 7;
    WHEN 'CLASS 8', '8', 'EIGHTH', 'VIII' THEN RETURN 8;
    WHEN 'CLASS 9', '9', 'NINTH', 'IX' THEN RETURN 9;
    WHEN 'CLASS 10', '10', 'TENTH', 'X' THEN RETURN 10;
    WHEN 'CLASS 11', '11', 'ELEVENTH', 'XI' THEN RETURN 11;
    WHEN 'CLASS 12', '12', 'TWELFTH', 'XII' THEN RETURN 12;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Update the generate_registration_number function to put subject code first
CREATE OR REPLACE FUNCTION public.generate_registration_number(p_school_id uuid, p_project_id uuid, p_student_class text, p_subject_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  year_code TEXT := '0'; -- Always use "0" instead of project year
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code INTEGER;
  student_seq INTEGER;
  student_code TEXT;
  subject_code INTEGER;
  registration_number TEXT;
  school_state TEXT;
  school_district TEXT;
BEGIN
  -- Get school's state and district
  SELECT s.state, s.district INTO school_state, school_district
  FROM public.schools s
  WHERE s.id = p_school_id;
  
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
  
  -- Get subject code
  subject_code := get_subject_code(p_subject_id);
  
  IF subject_code IS NULL THEN
    RAISE EXCEPTION 'Invalid subject ID: %', p_subject_id;
  END IF;
  
  -- Get next student sequence
  student_seq := get_next_student_sequence(p_school_id, p_project_id, class_code);
  
  -- Format student code (3-digit sequence)
  student_code := LPAD(student_seq::TEXT, 3, '0');
  
  -- Generate final registration number: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  registration_number := subject_code::TEXT || '-' || state_code || '-' || district_code || '-' || school_code || '-' || class_code::TEXT || '-' || student_code;
  
  RETURN registration_number;
END;
$function$;

-- Create migration function to update existing registration numbers
CREATE OR REPLACE FUNCTION public.migrate_registration_numbers_to_new_format()
 RETURNS TABLE(total_updated bigint, sample_old_format text, sample_new_format text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  old_number TEXT;
  new_number TEXT;
  parts TEXT[];
  subject_code TEXT;
  state_code TEXT;
  district_code TEXT;
  school_code TEXT;
  class_code TEXT;
  student_code TEXT;
  updated_count bigint := 0;
  sample_old TEXT;
  sample_new TEXT;
BEGIN
  -- Log the start of migration
  PERFORM public.log_security_action(
    'REGISTRATION_NUMBER_MIGRATION_START',
    'student_registrations',
    NULL,
    NULL,
    jsonb_build_object('timestamp', now(), 'total_records', (SELECT COUNT(*) FROM student_registrations WHERE registration_number_generated IS NOT NULL))
  );
  
  -- Loop through all student registrations with existing registration numbers
  FOR rec IN 
    SELECT sr.id, sr.registration_number_generated, sr.school_id, sr.project_id, sr.student_class,
           ss.subject_id
    FROM student_registrations sr
    JOIN student_subjects ss ON sr.id = ss.registration_id
    WHERE sr.registration_number_generated IS NOT NULL
    AND sr.registration_number_generated != ''
  LOOP
    old_number := rec.registration_number_generated;
    
    -- Store first sample for return
    IF sample_old IS NULL THEN
      sample_old := old_number;
    END IF;
    
    -- Parse the old format: 0-STATE-DISTRICT-SCHOOL-CLASSSTUDENT (where last part has class+student combined)
    parts := string_to_array(old_number, '-');
    
    -- Skip if format doesn't match expected pattern
    IF array_length(parts, 1) != 5 THEN
      CONTINUE;
    END IF;
    
    -- Extract components from old format
    state_code := parts[2];
    district_code := parts[3];
    school_code := parts[4];
    
    -- Extract class code and student code from the combined last part
    -- Class code is first 1-2 digits, student code is last 3 digits
    class_code := LEFT(parts[5], LENGTH(parts[5]) - 3);
    student_code := RIGHT(parts[5], 3);
    
    -- Get subject code for this registration
    subject_code := get_subject_code(rec.subject_id)::TEXT;
    
    IF subject_code IS NULL THEN
      CONTINUE;
    END IF;
    
    -- Generate new format: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
    new_number := subject_code || '-' || state_code || '-' || district_code || '-' || school_code || '-' || class_code || '-' || student_code;
    
    -- Store first sample of new format
    IF sample_new IS NULL THEN
      sample_new := new_number;
    END IF;
    
    -- Update the registration number
    UPDATE student_registrations 
    SET registration_number_generated = new_number,
        updated_at = now()
    WHERE id = rec.id;
    
    updated_count := updated_count + 1;
    
    -- Log every 100 updates for progress tracking
    IF updated_count % 100 = 0 THEN
      PERFORM public.log_security_action(
        'REGISTRATION_NUMBER_MIGRATION_PROGRESS',
        'student_registrations',
        NULL,
        NULL,
        jsonb_build_object('updated_count', updated_count, 'sample_conversion', jsonb_build_object('old', old_number, 'new', new_number))
      );
    END IF;
  END LOOP;
  
  -- Log completion
  PERFORM public.log_security_action(
    'REGISTRATION_NUMBER_MIGRATION_COMPLETE',
    'student_registrations',
    NULL,
    NULL,
    jsonb_build_object('total_updated', updated_count, 'timestamp', now())
  );
  
  RETURN QUERY SELECT updated_count, sample_old, sample_new;
END;
$function$;