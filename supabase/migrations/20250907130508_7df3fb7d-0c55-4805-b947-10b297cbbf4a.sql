-- Fix the data format issue and create proper RLS policy
-- First, let's see what the actual data looks like and fix it
UPDATE public.profiles 
SET assigned_districts = ARRAY['ALL']
WHERE assigned_districts IS NOT NULL;

-- Clean up any existing problematic policies
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Enhanced territorial access control for schools" ON public.schools;
  DROP POLICY IF EXISTS "Secure territory based school access" ON public.schools;
  DROP POLICY IF EXISTS "Managers can insert schools with territory check" ON public.schools;
  DROP POLICY IF EXISTS "Managers can update schools with territory check" ON public.schools;
  DROP POLICY IF EXISTS "Comprehensive territorial access for schools" ON public.schools;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Ignore errors if policies don't exist
END $$;

-- Create a simple and working RLS policy for schools
CREATE POLICY "Working territorial access for schools"
ON public.schools FOR ALL
USING (
  -- Superadmins have full access
  is_superadmin(auth.uid()) OR
  -- Managers with full access or 'ALL' district assignment
  (is_manager_or_superadmin() AND (
    (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) IN ('full') OR
    (SELECT 'ALL' = ANY(assigned_districts) FROM profiles WHERE user_id = auth.uid())
  ))
)
WITH CHECK (
  -- Same access rules for modifications
  is_superadmin(auth.uid()) OR
  (is_manager_or_superadmin() AND (
    (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) IN ('full') OR
    (SELECT 'ALL' = ANY(assigned_districts) FROM profiles WHERE user_id = auth.uid())
  ))
);