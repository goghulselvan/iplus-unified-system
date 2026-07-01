-- Fix the activity_type in the correction function
CREATE OR REPLACE FUNCTION correct_student_registration(
  p_registration_id uuid,
  p_new_class text DEFAULT NULL,
  p_new_subject_ids uuid[] DEFAULT NULL,
  p_corrected_by uuid DEFAULT NULL,
  p_correction_reason text DEFAULT 'Data entry correction'
)
RETURNS TABLE (
  success boolean,
  message text,
  new_registration_number text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_registration RECORD;
  v_new_registration_id uuid;
  v_new_reg_number text;
  v_class_code integer;
BEGIN
  -- Get the original registration details
  SELECT sr.*, ss.subject_id
  INTO v_old_registration
  FROM student_registrations sr
  LEFT JOIN student_subjects ss ON ss.registration_id = sr.id
  WHERE sr.id = p_registration_id
  LIMIT 1;
  
  IF v_old_registration IS NULL THEN
    RETURN QUERY SELECT false, 'Registration not found'::text, NULL::text;
    RETURN;
  END IF;
  
  -- Determine the class code if class is being changed
  IF p_new_class IS NOT NULL THEN
    CASE p_new_class
      WHEN 'LKG' THEN v_class_code := 14;
      WHEN 'UKG' THEN v_class_code := 15;
      WHEN '1' THEN v_class_code := 1;
      WHEN '2' THEN v_class_code := 2;
      WHEN '3' THEN v_class_code := 3;
      WHEN '4' THEN v_class_code := 4;
      WHEN '5' THEN v_class_code := 5;
      WHEN '6' THEN v_class_code := 6;
      WHEN '7' THEN v_class_code := 7;
      WHEN '8' THEN v_class_code := 8;
      WHEN '9' THEN v_class_code := 9;
      WHEN '10' THEN v_class_code := 10;
      WHEN '11' THEN v_class_code := 11;
      WHEN '12' THEN v_class_code := 12;
      ELSE v_class_code := v_old_registration.class_code;
    END CASE;
  ELSE
    v_class_code := v_old_registration.class_code;
  END IF;
  
  -- Mark the old registration as retired
  UPDATE student_registrations
  SET registration_number_generated = registration_number_generated || ' [RETIRED]',
      updated_at = now()
  WHERE id = p_registration_id;
  
  -- Create new registration with corrected information
  INSERT INTO student_registrations (
    project_id,
    school_id,
    student_name,
    student_class,
    class_code,
    created_by
  ) VALUES (
    v_old_registration.project_id,
    v_old_registration.school_id,
    v_old_registration.student_name,
    COALESCE(p_new_class, v_old_registration.student_class),
    v_class_code,
    COALESCE(p_corrected_by, v_old_registration.created_by)
  )
  RETURNING id INTO v_new_registration_id;
  
  -- Handle subject associations
  IF p_new_subject_ids IS NOT NULL AND array_length(p_new_subject_ids, 1) > 0 THEN
    INSERT INTO student_subjects (registration_id, subject_id)
    SELECT v_new_registration_id, unnest(p_new_subject_ids);
  ELSE
    INSERT INTO student_subjects (registration_id, subject_id)
    SELECT v_new_registration_id, subject_id
    FROM student_subjects
    WHERE registration_id = p_registration_id;
  END IF;
  
  -- Get the newly generated registration number
  SELECT registration_number_generated INTO v_new_reg_number
  FROM student_registrations
  WHERE id = v_new_registration_id;
  
  -- Log the correction with correct activity_type
  INSERT INTO activity_logs (
    school_id,
    project_id,
    user_id,
    activity_type,
    description,
    field_name,
    old_value,
    new_value
  ) VALUES (
    v_old_registration.school_id,
    v_old_registration.project_id,
    COALESCE(p_corrected_by, v_old_registration.created_by),
    'registration_corrected',
    p_correction_reason,
    'registration_correction',
    v_old_registration.registration_number_generated,
    v_new_reg_number
  );
  
  RETURN QUERY SELECT true, 'Registration corrected successfully'::text, v_new_reg_number;
END;
$$;