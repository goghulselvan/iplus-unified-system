-- Update 32 schools from "In Progress" to "Pending" with audit trail
-- Note: This runs as a system operation, so we'll use the first superadmin user for audit logs
DO $$
DECLARE
  system_user_id uuid;
  school_record RECORD;
  updated_count integer := 0;
BEGIN
  -- Get the first superadmin user for audit logging
  SELECT user_id INTO system_user_id
  FROM profiles
  WHERE role = 'superadmin'
  ORDER BY created_at
  LIMIT 1;
  
  -- Verify we have a user to log against
  IF system_user_id IS NULL THEN
    RAISE EXCEPTION 'No superadmin user found for audit logging';
  END IF;
  
  -- Update schools and create audit trail
  FOR school_record IN 
    SELECT id, ss_no, school_name, current_project_id
    FROM schools 
    WHERE registration_status = 'In Progress'
    ORDER BY ss_no
  LOOP
    -- Update school status
    UPDATE schools 
    SET 
      registration_status = 'Pending',
      updated_at = now()
    WHERE id = school_record.id;
    
    -- Log to activity_logs
    INSERT INTO activity_logs (
      school_id,
      user_id,
      activity_type,
      field_name,
      old_value,
      new_value,
      description,
      project_id
    ) VALUES (
      school_record.id,
      system_user_id,
      'status_update',
      'registration_status',
      'In Progress',
      'Pending',
      'Updated registration_status from In Progress to Pending (System Migration)',
      school_record.current_project_id
    );
    
    -- Log to workflow_history
    INSERT INTO workflow_history (
      school_id,
      workflow_stage,
      old_status,
      new_status,
      changed_by,
      project_id
    ) VALUES (
      school_record.id,
      'registration_status',
      'In Progress',
      'Pending',
      system_user_id,
      school_record.current_project_id
    );
    
    updated_count := updated_count + 1;
  END LOOP;
  
  -- Log summary
  RAISE NOTICE 'Successfully updated % schools from "In Progress" to "Pending"', updated_count;
END $$;