-- Clean up conflicting RLS policies and create a single comprehensive one
DROP POLICY IF EXISTS "Enhanced territorial access control for schools" ON public.schools;
DROP POLICY IF EXISTS "Secure territory based school access" ON public.schools;
DROP POLICY IF EXISTS "Managers can insert schools with territory check" ON public.schools;
DROP POLICY IF EXISTS "Managers can update schools with territory check" ON public.schools;

-- Create a comprehensive and correct RLS policy for schools
CREATE POLICY "Comprehensive territorial access for schools"
ON public.schools FOR ALL
USING (
  -- Superadmins have full access
  is_superadmin(auth.uid()) OR
  -- Regular managers/authenticated users with appropriate access
  (is_manager_or_superadmin() AND (
    -- Full access users can see everything
    (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) = 'full' OR
    -- Users with 'ALL' districts assignment (legacy compatibility)
    'ALL' = ANY((SELECT assigned_districts FROM profiles WHERE user_id = auth.uid())) OR
    -- Regional access based on district assignment
    (
      (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) = 'regional' AND
      district = ANY((SELECT assigned_districts FROM profiles WHERE user_id = auth.uid()))
    )
  ))
)
WITH CHECK (
  -- Same logic for modifications
  is_superadmin(auth.uid()) OR
  (is_manager_or_superadmin() AND (
    (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) = 'full' OR
    'ALL' = ANY((SELECT assigned_districts FROM profiles WHERE user_id = auth.uid())) OR
    (
      (SELECT data_access_level FROM profiles WHERE user_id = auth.uid()) = 'regional' AND
      district = ANY((SELECT assigned_districts FROM profiles WHERE user_id = auth.uid()))
    )
  ))
);