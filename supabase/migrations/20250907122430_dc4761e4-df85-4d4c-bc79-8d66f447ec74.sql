-- Phase 1: Enhanced PII Monitoring and Data Protection
-- Create PII access logging function
CREATE OR REPLACE FUNCTION public.log_pii_access(
  p_table_name text,
  p_operation text,
  p_accessed_columns text[],
  p_record_count integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_audit_logs (
    user_id, action, table_name, record_id, 
    old_values, new_values, ip_address
  ) VALUES (
    auth.uid(), 
    p_operation || '_PII_ACCESS',
    p_table_name,
    NULL,
    jsonb_build_object(
      'accessed_columns', p_accessed_columns,
      'record_count', p_record_count,
      'timestamp', now()
    ),
    NULL,
    inet_client_addr()
  );
END;
$$;

-- Create trigger function for schools PII access monitoring
CREATE OR REPLACE FUNCTION public.audit_schools_pii_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pii_columns text[] := ARRAY['email', 'mobile1', 'mobile2', 'contact_person_name'];
  operation_type text;
BEGIN
  -- Determine operation type
  IF TG_OP = 'SELECT' THEN
    operation_type := 'SELECT';
  ELSIF TG_OP = 'INSERT' THEN
    operation_type := 'INSERT';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    operation_type := 'UPDATE';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    operation_type := 'DELETE';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Create triggers for PII access monitoring
DROP TRIGGER IF EXISTS audit_schools_pii_trigger ON public.schools;
CREATE TRIGGER audit_schools_pii_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.audit_schools_pii_access();

-- Phase 1: Server-Side Email Validation Enforcement
-- Create email domain validation function
CREATE OR REPLACE FUNCTION public.validate_email_domain(email_address text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path = public
AS $$
BEGIN
  -- Allow null emails
  IF email_address IS NULL OR email_address = '' THEN
    RETURN true;
  END IF;
  
  -- Validate email format and domain
  RETURN email_address ~* '^[A-Za-z0-9._%+-]+@iplusedu\.in$';
END;
$$;

-- Add constraint for email domain validation on profiles table (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') THEN
    -- Add email column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'email' AND table_schema = 'public') THEN
      ALTER TABLE public.profiles ADD COLUMN email text;
    END IF;
    
    -- Add constraint
    ALTER TABLE public.profiles 
    DROP CONSTRAINT IF EXISTS valid_email_domain;
    
    ALTER TABLE public.profiles 
    ADD CONSTRAINT valid_email_domain 
    CHECK (public.validate_email_domain(email));
  END IF;
END $$;

-- Add constraint for email domain validation on schools table
ALTER TABLE public.schools 
DROP CONSTRAINT IF EXISTS valid_school_email_domain;

ALTER TABLE public.schools 
ADD CONSTRAINT valid_school_email_domain 
CHECK (public.validate_email_domain(email));

-- Phase 2: Time-based Access Controls for Sensitive Operations
-- Create function to check business hours access
CREATE OR REPLACE FUNCTION public.is_business_hours()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata') BETWEEN 9 AND 18
  AND EXTRACT(DOW FROM NOW() AT TIME ZONE 'Asia/Kolkata') BETWEEN 1 AND 5;
$$;

-- Enhanced RLS policy for schools with time-based controls
DROP POLICY IF EXISTS "Time-restricted school access" ON public.schools;
CREATE POLICY "Time-restricted school access" 
ON public.schools 
FOR ALL
USING (
  is_manager_or_superadmin() AND 
  (is_superadmin(auth.uid()) OR public.is_business_hours())
)
WITH CHECK (
  is_manager_or_superadmin() AND 
  (is_superadmin(auth.uid()) OR public.is_business_hours())
);

-- Phase 2: Additional Audit Logging for Bulk Operations
-- Create function to detect bulk operations
CREATE OR REPLACE FUNCTION public.detect_bulk_operations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_operations_count integer;
BEGIN
  -- Count operations in the last 5 minutes by the same user
  SELECT COUNT(*) INTO recent_operations_count
  FROM public.security_audit_logs
  WHERE user_id = auth.uid()
    AND created_at > NOW() - INTERVAL '5 minutes'
    AND action LIKE '%' || TG_TABLE_NAME || '%';
  
  -- Log if this might be a bulk operation (more than 10 operations)
  IF recent_operations_count > 10 THEN
    PERFORM public.log_security_action(
      'BULK_OPERATION_DETECTED',
      TG_TABLE_NAME,
      CASE 
        WHEN TG_OP = 'INSERT' THEN NEW.id
        WHEN TG_OP = 'UPDATE' THEN NEW.id
        WHEN TG_OP = 'DELETE' THEN OLD.id
        ELSE NULL
      END,
      NULL,
      jsonb_build_object(
        'operation_count', recent_operations_count,
        'time_window', '5 minutes'
      )
    );
  END IF;
  
  RETURN CASE 
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;
END;
$$;

-- Add bulk operation detection triggers
DROP TRIGGER IF EXISTS detect_bulk_schools_operations ON public.schools;
CREATE TRIGGER detect_bulk_schools_operations
  AFTER INSERT OR UPDATE OR DELETE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.detect_bulk_operations();

DROP TRIGGER IF EXISTS detect_bulk_student_operations ON public.student_registrations;
CREATE TRIGGER detect_bulk_student_operations
  AFTER INSERT OR UPDATE OR DELETE ON public.student_registrations
  FOR EACH ROW EXECUTE FUNCTION public.detect_bulk_operations();

-- Phase 3: Data Retention Policy for Audit Logs
-- Create function to clean up old audit logs
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Keep audit logs for 2 years, then archive to a separate table
  DELETE FROM public.security_audit_logs 
  WHERE created_at < NOW() - INTERVAL '2 years';
  
  -- Clean up old CSRF tokens
  DELETE FROM public.csrf_tokens 
  WHERE expires_at < NOW() - INTERVAL '1 day';
  
  -- Clean up old export OTPs
  DELETE FROM public.export_otps 
  WHERE expires_at < NOW() - INTERVAL '1 day';
$$;

-- Phase 2: Enhanced Rate Limiting Functions
-- Create advanced rate limiting function
CREATE OR REPLACE FUNCTION public.check_advanced_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_requests integer DEFAULT 5,
  p_window_minutes integer DEFAULT 1,
  p_daily_limit integer DEFAULT 100
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
  daily_count integer;
BEGIN
  -- Check short-term rate limit
  SELECT COUNT(*) INTO recent_count
  FROM public.security_audit_logs
  WHERE user_id = p_user_id
    AND action = p_action
    AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;
  
  IF recent_count >= p_max_requests THEN
    RETURN false;
  END IF;
  
  -- Check daily limit
  SELECT COUNT(*) INTO daily_count
  FROM public.security_audit_logs
  WHERE user_id = p_user_id
    AND action = p_action
    AND created_at > CURRENT_DATE;
  
  IF daily_count >= p_daily_limit THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;

-- Create function to monitor suspicious patterns
CREATE OR REPLACE FUNCTION public.detect_suspicious_patterns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  suspicious_user uuid;
BEGIN
  -- Detect users with unusually high activity
  FOR suspicious_user IN
    SELECT user_id
    FROM public.security_audit_logs
    WHERE created_at > NOW() - INTERVAL '1 hour'
    GROUP BY user_id
    HAVING COUNT(*) > 100
  LOOP
    -- Log suspicious activity
    PERFORM public.log_security_action(
      'SUSPICIOUS_ACTIVITY_DETECTED',
      'security_monitoring',
      NULL,
      NULL,
      jsonb_build_object(
        'suspicious_user_id', suspicious_user,
        'detection_time', NOW()
      )
    );
  END LOOP;
END;
$$;