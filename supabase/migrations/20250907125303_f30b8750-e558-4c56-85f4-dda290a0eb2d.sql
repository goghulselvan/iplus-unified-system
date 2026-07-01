-- Fix policy conflict and complete the secure implementation

-- First, check and drop any existing policies that might conflict
DO $$ 
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Secure schools access with territory restrictions" ON public.schools;
  DROP POLICY IF EXISTS "Only authenticated managers and superadmins can view schools" ON public.schools;
  DROP POLICY IF EXISTS "Granular access to schools data based on territory" ON public.schools;
  DROP POLICY IF EXISTS "Bulk export requires superadmin approval" ON public.schools;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Ignore errors if policies don't exist
END $$;

-- Create the new secure access policy for schools
CREATE POLICY "Secure territorial access to schools data"
ON public.schools FOR SELECT
USING (
  -- Superadmins have full access to all schools
  is_superadmin(auth.uid()) OR
  -- Managers must have appropriate territorial access
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Create export approval tracking table if it doesn't exist
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

-- Enable RLS on export approvals if not already enabled
DO $$
BEGIN
  ALTER TABLE public.data_export_approvals ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Ignore if already enabled
END $$;

-- Create policies for export approvals if they don't exist
DO $$
BEGIN
  CREATE POLICY "Only superadmins can manage export approvals"
  ON public.data_export_approvals FOR ALL
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));
EXCEPTION WHEN duplicate_object THEN
  NULL; -- Policy already exists
END $$;

-- Log the security enhancement completion
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, 
  old_values, new_values
) VALUES (
  auth.uid(),
  'SECURITY_ENHANCEMENT_APPLIED',
  'schools',
  jsonb_build_object('previous_access', 'unrestricted_manager_access'),
  jsonb_build_object(
    'new_access', 'territorial_restricted_access',
    'features_added', ARRAY[
      'territorial_access_control',
      'data_export_approval_workflow', 
      'sensitive_data_access_logging',
      'granular_permissions'
    ],
    'protection_level', 'high',
    'implementation_date', now()
  )
);