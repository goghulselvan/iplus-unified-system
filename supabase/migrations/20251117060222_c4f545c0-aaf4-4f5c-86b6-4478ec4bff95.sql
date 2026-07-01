-- Update RLS policies to allow managers to delete student registrations and subjects

-- Drop existing policies
DROP POLICY IF EXISTS "Superadmins can delete any student registration" ON student_registrations;
DROP POLICY IF EXISTS "Superadmins can delete any student subject" ON student_subjects;

-- Create new policies allowing managers and superadmins
CREATE POLICY "Managers can delete any student registration" 
ON student_registrations 
FOR DELETE 
TO authenticated 
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can delete any student subject" 
ON student_subjects 
FOR DELETE 
TO authenticated 
USING (is_manager_or_superadmin());

-- Update the RPC function to allow managers
CREATE OR REPLACE FUNCTION public.delete_student_registrations_by_school(
  p_school_id uuid, 
  p_specific_student_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count integer := 0;
  affected_sequences RECORD;
BEGIN
  -- Only managers and superadmins can delete registrations
  IF NOT is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers and superadmins can delete student registrations';
  END IF;
  
  -- Delete specific students if provided, otherwise delete all for school
  IF p_specific_student_ids IS NOT NULL THEN
    -- Delete specific students
    DELETE FROM public.student_subjects 
    WHERE registration_id IN (
      SELECT id FROM public.student_registrations 
      WHERE school_id = p_school_id 
      AND id = ANY(p_specific_student_ids)
    );
    
    DELETE FROM public.student_registrations 
    WHERE school_id = p_school_id 
    AND id = ANY(p_specific_student_ids);
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSE
    -- Delete all registrations for the school
    DELETE FROM public.student_subjects 
    WHERE registration_id IN (
      SELECT id FROM public.student_registrations 
      WHERE school_id = p_school_id
    );
    
    DELETE FROM public.student_registrations 
    WHERE school_id = p_school_id;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Reset sequences for this school (restart student series)
    DELETE FROM public.student_registration_sequences 
    WHERE school_id = p_school_id;
  END IF;
  
  -- Log the deletion
  PERFORM public.log_security_action(
    'DELETE_STUDENT_REGISTRATIONS',
    'student_registrations',
    p_school_id,
    NULL,
    jsonb_build_object(
      'deleted_count', deleted_count,
      'school_id', p_school_id,
      'specific_students', p_specific_student_ids,
      'action_type', CASE 
        WHEN p_specific_student_ids IS NOT NULL THEN 'selective_delete'
        ELSE 'full_delete'
      END
    )
  );
  
  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'message', format('Successfully deleted %s student registration(s)', deleted_count),
    'deleted_count', deleted_count
  );
END;
$function$;