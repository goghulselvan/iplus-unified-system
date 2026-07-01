-- Create function to safely correct student registrations by deleting and recreating
CREATE OR REPLACE FUNCTION correct_student_registration(
  p_registration_id uuid,
  p_new_class text DEFAULT NULL,
  p_new_subject_ids uuid[] DEFAULT NULL,
  p_corrected_by uuid DEFAULT NULL,
  p_correction_reason text DEFAULT 'Data entry correction'
)
RETURNS TABLE(
  success boolean,
  new_registration_id uuid,
  new_registration_number text,
  message text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_registration RECORD;
  v_new_registration_id uuid;
  v_new_registration_number text;
  v_old_subjects text[];
  v_new_subjects text[];
  v_corrected_by_user uuid;
BEGIN
  -- Use provided user ID or fall back to auth.uid()
  v_corrected_by_user := COALESCE(p_corrected_by, auth.uid());
  
  -- Check if user has permission
  IF NOT is_manager_or_superadmin() THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'Insufficient permissions'::text;
    RETURN;
  END IF;

  -- Fetch existing registration data
  SELECT sr.*, sr.student_name, sr.student_class, sr.school_id, sr.project_id, sr.registration_number
  INTO v_old_registration
  FROM student_registrations sr
  WHERE sr.id = p_registration_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, 'Registration not found'::text;
    RETURN;
  END IF;

  -- Get old subjects for logging
  SELECT array_agg(os.subject_name ORDER BY os.subject_name)
  INTO v_old_subjects
  FROM student_subjects ss
  JOIN olympiad_subjects os ON ss.subject_id = os.id
  WHERE ss.registration_id = p_registration_id;

  -- Get new subjects for logging
  IF p_new_subject_ids IS NOT NULL THEN
    SELECT array_agg(os.subject_name ORDER BY os.subject_name)
    INTO v_new_subjects
    FROM olympiad_subjects os
    WHERE os.id = ANY(p_new_subject_ids);
  ELSE
    v_new_subjects := v_old_subjects;
  END IF;

  -- Log the correction to activity_logs BEFORE deletion
  INSERT INTO activity_logs (
    activity_type,
    school_id,
    project_id,
    user_id,
    field_name,
    old_value,
    new_value,
    description
  ) VALUES (
    'registration_corrected',
    v_old_registration.school_id,
    v_old_registration.project_id,
    v_corrected_by_user,
    'student_registration',
    jsonb_build_object(
      'registration_id', p_registration_id,
      'registration_number', v_old_registration.registration_number,
      'student_name', v_old_registration.student_name,
      'class', v_old_registration.student_class,
      'subjects', v_old_subjects
    )::text,
    jsonb_build_object(
      'student_name', v_old_registration.student_name,
      'class', COALESCE(p_new_class, v_old_registration.student_class),
      'subjects', v_new_subjects,
      'reason', p_correction_reason
    )::text,
    format('Registration corrected: %s', p_correction_reason)
  );

  -- Delete old registration (cascade will delete student_subjects automatically)
  DELETE FROM student_registrations WHERE id = p_registration_id;

  -- Create new registration with corrected data
  INSERT INTO student_registrations (
    project_id,
    school_id,
    student_name,
    student_class,
    created_by
  ) VALUES (
    v_old_registration.project_id,
    v_old_registration.school_id,
    v_old_registration.student_name,
    COALESCE(p_new_class, v_old_registration.student_class),
    v_corrected_by_user
  )
  RETURNING id, registration_number INTO v_new_registration_id, v_new_registration_number;

  -- Insert new subject associations
  IF p_new_subject_ids IS NOT NULL THEN
    INSERT INTO student_subjects (registration_id, subject_id)
    SELECT v_new_registration_id, unnest(p_new_subject_ids);
  ELSE
    -- Keep old subjects if no new ones specified
    INSERT INTO student_subjects (registration_id, subject_id)
    SELECT v_new_registration_id, subject_id
    FROM student_subjects
    WHERE registration_id = p_registration_id;
  END IF;

  -- Update activity log with new registration details
  UPDATE activity_logs
  SET new_value = jsonb_build_object(
    'registration_id', v_new_registration_id,
    'registration_number', v_new_registration_number,
    'student_name', v_old_registration.student_name,
    'class', COALESCE(p_new_class, v_old_registration.student_class),
    'subjects', v_new_subjects,
    'reason', p_correction_reason
  )::text
  WHERE activity_type = 'registration_corrected'
    AND school_id = v_old_registration.school_id
    AND user_id = v_corrected_by_user
    AND created_at = (
      SELECT MAX(created_at)
      FROM activity_logs
      WHERE activity_type = 'registration_corrected'
        AND school_id = v_old_registration.school_id
        AND user_id = v_corrected_by_user
    );

  RETURN QUERY SELECT 
    true,
    v_new_registration_id,
    v_new_registration_number,
    format('Registration corrected successfully. New number: %s', v_new_registration_number)::text;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION correct_student_registration TO authenticated;