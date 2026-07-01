-- Update migration function to handle the correct 6-part format
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
  class_student_part TEXT;
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
    
    -- Parse the old format: 33-STATE-DISTRICT-SCHOOL-CLASSSTUDENT-SUBJECT (6 parts)
    parts := string_to_array(old_number, '-');
    
    -- Skip if format doesn't match expected 6-part pattern
    IF array_length(parts, 1) != 6 THEN
      CONTINUE;
    END IF;
    
    -- Extract components from old format
    -- parts[1] = year_code (33)
    -- parts[2] = state_code  
    -- parts[3] = district_code
    -- parts[4] = school_code
    -- parts[5] = class_code + student_code (e.g., "014")
    -- parts[6] = subject_code
    
    state_code := parts[2];
    district_code := parts[3];
    school_code := parts[4];
    class_student_part := parts[5];
    subject_code := parts[6];
    
    -- Extract class code and student code from the combined part
    -- For numbers like "014", class is "0" and student is "14"
    -- For numbers like "1073", class is "10" and student is "73"
    IF LENGTH(class_student_part) = 3 THEN
      -- Format like "014" -> class "0", student "14"
      class_code := LEFT(class_student_part, 1);
      student_code := RIGHT(class_student_part, 2);
    ELSIF LENGTH(class_student_part) = 4 THEN
      -- Format like "1073" -> class "10", student "73" 
      class_code := LEFT(class_student_part, 2);
      student_code := RIGHT(class_student_part, 2);
    ELSE
      -- Handle other lengths by assuming last 3 digits are student code
      class_code := LEFT(class_student_part, LENGTH(class_student_part) - 3);
      student_code := RIGHT(class_student_part, 3);
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