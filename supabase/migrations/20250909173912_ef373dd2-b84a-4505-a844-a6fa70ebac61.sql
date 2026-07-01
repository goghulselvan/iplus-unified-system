-- Update the log_security_action function to handle null user_id during migrations
CREATE OR REPLACE FUNCTION public.log_security_action(p_action text, p_table_name text, p_record_id uuid DEFAULT NULL::uuid, p_old_values jsonb DEFAULT NULL::jsonb, p_new_values jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip logging if auth.uid() is null (during migrations)
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  
  INSERT INTO public.security_audit_logs (
    user_id, action, table_name, record_id, old_values, new_values, ip_address
  ) VALUES (
    auth.uid(), p_action, p_table_name, p_record_id, p_old_values, p_new_values, 
    inet_client_addr()
  );
END;
$function$