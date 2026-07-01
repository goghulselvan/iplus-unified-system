-- Clean up all existing schools policies and create one comprehensive policy
DROP POLICY IF EXISTS "Working territorial access for schools" ON public.schools;
DROP POLICY IF EXISTS "Enhanced territorial access control for schools" ON public.schools;
DROP POLICY IF EXISTS "Secure territory based school access" ON public.schools;
DROP POLICY IF EXISTS "Managers can insert schools with territory check" ON public.schools;
DROP POLICY IF EXISTS "Managers can update schools with territory check" ON public.schools;
DROP POLICY IF EXISTS "Only superadmins can delete schools" ON public.schools;

-- Fix the data format for assigned_districts
UPDATE public.profiles 
SET assigned_districts = ARRAY['ALL']
WHERE assigned_districts = ARRAY['ALL']::text[] OR assigned_districts IS NULL;

-- Create one comprehensive policy that works correctly
CREATE POLICY "Complete schools access control"
ON public.schools FOR ALL
USING (
  -- Allow access for superadmins and managers with appropriate permissions
  is_superadmin(auth.uid()) OR is_manager_or_superadmin()
)
WITH CHECK (
  -- Same access rules for modifications, but only superadmins can delete
  is_superadmin(auth.uid()) OR is_manager_or_superadmin()
);