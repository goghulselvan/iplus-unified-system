-- Update the validate_sensitive_operation function to restrict bulk export/delete for managers
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
  
  -- Superadmins can always perform all operations (no restrictions)
  IF is_superadmin(auth.uid()) THEN
    RETURN true;
  END IF;
  
  -- Block managers from bulk export and bulk delete operations completely
  IF p_operation IN ('BULK_EXPORT', 'BULK_DELETE') THEN
    PERFORM public.log_security_action(
      'MANAGER_BULK_OPERATION_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object(
        'operation', p_operation, 
        'reason', 'Managers not authorized for bulk export/delete operations'
      )
    );
    RETURN false;
  END IF;
  
  -- Check rate limits for allowed operations
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
  
  -- For bulk create registrations and updates, check business hours for managers
  IF p_operation IN ('BULK_CREATE_REGISTRATIONS', 'BULK_UPDATE') 
     AND NOT public.is_business_hours() THEN
    PERFORM public.log_security_action(
      'AFTER_HOURS_ACCESS_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object(
        'operation', p_operation, 
        'business_hours', '9 AM - 6 PM IST, Mon-Fri'
      )
    );
    RETURN false;
  END IF;
  
  -- Allow managers to create student registrations during business hours
  IF p_operation = 'BULK_CREATE_REGISTRATIONS' AND is_manager_or_superadmin() THEN
    RETURN true;
  END IF;
  
  -- Allow managers to do bulk updates during business hours
  IF p_operation = 'BULK_UPDATE' AND is_manager_or_superadmin() THEN
    RETURN true;
  END IF;
  
  RETURN true;
END;
$$;