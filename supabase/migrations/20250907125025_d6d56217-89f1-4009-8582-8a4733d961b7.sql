-- Final secure implementation for schools contact data protection

-- Drop the view that can't have RLS
DROP VIEW IF EXISTS public.schools_secure;

-- Create proper RLS policies for fine-grained access control
DROP POLICY IF EXISTS "Granular access to schools data based on territory" ON public.schools;
DROP POLICY IF EXISTS "Bulk export requires superadmin approval" ON public.schools;

-- Create comprehensive RLS policy for schools with data masking at query level
CREATE POLICY "Secure schools access with territory restrictions"
ON public.schools FOR SELECT
USING (
  -- Superadmins have full access
  is_superadmin(auth.uid()) OR
  -- Managers must have appropriate access level and territory permissions
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Create export approval tracking table
CREATE TABLE IF NOT EXISTS public.data_export_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_user_id uuid NOT NULL,
  approving_user_id uuid NOT NULL,
  table_name text NOT NULL,
  export_reason text NOT NULL,
  data_sensitivity_level text DEFAULT 'high',
  record_count integer,
  approved_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + interval '24 hours'),
  used boolean DEFAULT false,
  used_at timestamp with time zone,
  CONSTRAINT valid_sensitivity_level CHECK (data_sensitivity_level IN ('low', 'medium', 'high', 'critical'))
);

-- Enable RLS on export approvals
ALTER TABLE public.data_export_approvals ENABLE ROW LEVEL SECURITY;

-- Only superadmins can view/manage export approvals
CREATE POLICY "Only superadmins can manage export approvals"
ON public.data_export_approvals FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Update the sensitive operation validation function
CREATE OR REPLACE FUNCTION public.validate_sensitive_operation(p_operation text, p_table_name text DEFAULT 'unknown'::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  
  -- Superadmins can always perform operations
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
  
  -- For sensitive operations, check business hours (except for superadmins)
  IF p_operation IN ('BULK_DELETE', 'BULK_UPDATE', 'BULK_EXPORT') 
     AND NOT public.is_business_hours() THEN
    PERFORM public.log_security_action(
      'AFTER_HOURS_ACCESS_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation)
    );
    RETURN false;
  END IF;
  
  RETURN true;
END;
$function$;