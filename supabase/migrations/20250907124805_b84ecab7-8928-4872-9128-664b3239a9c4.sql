-- Create granular access control for schools data
-- Add territory/region assignment to users for data compartmentalization

-- Add territory assignment columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS assigned_districts text[],
ADD COLUMN IF NOT EXISTS data_access_level text DEFAULT 'limited' CHECK (data_access_level IN ('limited', 'regional', 'full'));

-- Create audit trail for sensitive data access
CREATE TABLE IF NOT EXISTS public.sensitive_data_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL,
  record_count integer DEFAULT 1,
  sensitive_columns text[],
  access_reason text,
  created_at timestamp with time zone DEFAULT now(),
  ip_address inet DEFAULT inet_client_addr()
);

-- Enable RLS on audit log
ALTER TABLE public.sensitive_data_access_log ENABLE ROW LEVEL SECURITY;

-- Only superadmins can view audit logs
CREATE POLICY "Only superadmins can view sensitive data access logs"
ON public.sensitive_data_access_log FOR SELECT
USING (is_superadmin(auth.uid()));

-- Create function to check if user can access school data
CREATE OR REPLACE FUNCTION public.can_access_school_data(school_district text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_profile RECORD;
BEGIN
  -- Get user profile with access permissions
  SELECT assigned_districts, data_access_level, role 
  INTO user_profile
  FROM public.profiles 
  WHERE user_id = auth.uid();
  
  -- Superadmins have full access
  IF user_profile.role = 'superadmin' THEN
    RETURN true;
  END IF;
  
  -- Users with full access level can see all data
  IF user_profile.data_access_level = 'full' THEN
    RETURN true;
  END IF;
  
  -- Regional access - check if district is in assigned districts
  IF user_profile.data_access_level = 'regional' AND school_district IS NOT NULL THEN
    RETURN school_district = ANY(user_profile.assigned_districts);
  END IF;
  
  -- Limited access by default for managers
  IF user_profile.role = 'manager' AND user_profile.data_access_level = 'limited' THEN
    RETURN false;
  END IF;
  
  RETURN false;
END;
$function$;

-- Function to log sensitive data access
CREATE OR REPLACE FUNCTION public.log_sensitive_data_access(
  p_table_name text,
  p_operation text,
  p_record_count integer DEFAULT 1,
  p_sensitive_columns text[] DEFAULT NULL,
  p_access_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.sensitive_data_access_log (
    user_id, table_name, operation, record_count, 
    sensitive_columns, access_reason, ip_address
  ) VALUES (
    auth.uid(), p_table_name, p_operation, p_record_count,
    p_sensitive_columns, p_access_reason, inet_client_addr()
  );
END;
$function$;

-- Update existing profiles to have full access (to maintain current functionality)
UPDATE public.profiles 
SET data_access_level = 'full', 
    assigned_districts = ARRAY['ALL']
WHERE role IN ('manager', 'superadmin');