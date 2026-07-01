-- Update the migration function with correct format parsing
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
    
    -- Parse the old format: STATE-DISTRICT-SCHOOL-CLASS-STUDENT-SUBJECT
    parts := string_to_array(old_number, '-');
    
    -- Skip if format doesn't match expected pattern (should have 6 parts)
    IF array_length(parts, 1) != 6 THEN
      CONTINUE;
    END IF;
    
    -- Extract components from old format
    -- parts[1] = state_code (e.g., "33")
    -- parts[2] = district_code (e.g., "011") 
    -- parts[3] = school_code (e.g., "001")
    -- parts[4] = class_code (e.g., "14")
    -- parts[5] = student_code (e.g., "001")
    -- parts[6] = subject_code (e.g., "0")
    
    state_code := parts[1];
    district_code := parts[2];
    school_code := parts[3];
    class_code := parts[4];
    student_code := parts[5];
    subject_code := parts[6];
    
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
    
    -- Log every 500 updates for progress tracking
    IF updated_count % 500 = 0 THEN
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