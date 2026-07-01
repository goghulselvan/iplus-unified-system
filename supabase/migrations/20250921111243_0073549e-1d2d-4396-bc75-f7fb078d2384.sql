-- Fix the automatic namelist status update function to handle Pending status
CREATE OR REPLACE FUNCTION public.update_school_namelist_status(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  registration_count INTEGER;
  current_status name_list_status;
BEGIN
  -- Get current name list status
  SELECT name_list_status INTO current_status
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Count student registrations for this school
  SELECT COUNT(*) INTO registration_count
  FROM public.student_registrations
  WHERE school_id = p_school_id;
  
  -- Update status based on registration count
  IF registration_count > 0 AND current_status IN ('Pending', 'Received') THEN
    -- Change from Pending/Received to Uploaded when registrations exist
    UPDATE public.schools
    SET name_list_status = 'Uploaded', updated_at = now()
    WHERE id = p_school_id;
    
    -- Log the automatic status change
    PERFORM public.log_security_action(
      'AUTO_NAMELIST_STATUS_UPDATE',
      'schools',
      p_school_id,
      jsonb_build_object('old_status', current_status),
      jsonb_build_object('new_status', 'Uploaded', 'registration_count', registration_count)
    );
  ELSIF registration_count = 0 AND current_status = 'Uploaded' THEN
    -- Change from Uploaded back to Received when no registrations exist
    UPDATE public.schools
    SET name_list_status = 'Received', updated_at = now()
    WHERE id = p_school_id;
    
    -- Log the automatic status change
    PERFORM public.log_security_action(
      'AUTO_NAMELIST_STATUS_UPDATE',
      'schools',
      p_school_id,
      jsonb_build_object('old_status', current_status),
      jsonb_build_object('new_status', 'Received', 'registration_count', registration_count)
    );
  END IF;
END;
$function$;

-- Fix the 3 schools that are stuck in Pending status but have registrations
UPDATE public.schools 
SET name_list_status = 'Uploaded', updated_at = now()
WHERE name_list_status = 'Pending' 
AND id IN (
  SELECT DISTINCT school_id 
  FROM public.student_registrations
);