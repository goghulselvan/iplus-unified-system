-- Fix district naming inconsistency
UPDATE district_codes 
SET district_name = 'Kanyakumari' 
WHERE district_name = 'Kanniyakumari';

-- Add function to delete student registrations for superadmin
CREATE OR REPLACE FUNCTION public.delete_student_registrations_by_school(
  p_school_id uuid,
  p_specific_student_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  deleted_count integer := 0;
  affected_sequences RECORD;
BEGIN
  -- Only superadmins can delete registrations
  IF NOT is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only superadmins can delete student registrations';
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
        WHEN p_specific_student_ids IS NOT NULL THEN 'specific_students'
        ELSE 'all_students'
      END
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', deleted_count,
    'message', 'Student registrations deleted successfully'
  );
END;
$function$;