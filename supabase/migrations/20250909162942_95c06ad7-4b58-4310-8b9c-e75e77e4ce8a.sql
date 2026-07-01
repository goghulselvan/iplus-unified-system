-- Update the validate_sensitive_operation function to enforce business hours for managers
CREATE OR REPLACE FUNCTION public.validate_sensitive_operation(
  p_operation TEXT,
  p_table_name TEXT DEFAULT 'unknown'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  valid_approval RECORD;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    PERFORM public.log_security_action(
      'UNAUTHORIZED_ACCESS_ATTEMPT',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation)
    );
    RETURN false;
  END IF;
  
  -- Superadmins can always perform operations (no business hours restriction)
  IF is_superadmin(auth.uid()) THEN
    RETURN true;
  END IF;
  
  -- Check rate limits
  IF NOT public.check_advanced_rate_limit(auth.uid(), p_operation, 10, 1, 200) THEN
    PERFORM public.log_security_action(
      'RATE_LIMIT_EXCEEDED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation)
    );
    RETURN false;
  END IF;
  
  -- For sensitive export operations, check for valid approval
  IF p_operation = 'BULK_EXPORT' THEN
    SELECT * INTO valid_approval
    FROM public.data_export_approvals
    WHERE requesting_user_id = auth.uid()
      AND table_name = p_table_name
      AND expires_at > now()
      AND NOT used;
    
    IF NOT FOUND THEN
      PERFORM public.log_security_action(
        'EXPORT_ACCESS_DENIED',
        p_table_name,
        NULL,
        NULL,
        jsonb_build_object('operation', p_operation, 'reason', 'No valid approval found')
      );
      RETURN false;
    END IF;
    
    -- Mark approval as used
    UPDATE public.data_export_approvals
    SET used = true, used_at = now()
    WHERE id = valid_approval.id;
  END IF;
  
  -- For ALL bulk operations (including registrations), check business hours for managers
  -- Only superadmins are exempt from business hours restrictions
  IF p_operation IN ('BULK_DELETE', 'BULK_UPDATE', 'BULK_EXPORT', 'BULK_CREATE_REGISTRATIONS') 
     AND NOT public.is_business_hours() THEN
    PERFORM public.log_security_action(
      'AFTER_HOURS_ACCESS_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation, 'business_hours', '9 AM - 6 PM IST, Mon-Fri')
    );
    RETURN false;
  END IF;
  
  -- Allow managers to create student registrations during business hours
  IF p_operation = 'BULK_CREATE_REGISTRATIONS' AND is_manager_or_superadmin() THEN
    RETURN true;
  END IF;
  
  RETURN true;
END;
$$;