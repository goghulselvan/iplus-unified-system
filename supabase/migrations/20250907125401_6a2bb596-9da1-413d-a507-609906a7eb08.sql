-- Clean up all existing school policies properly
DO $$ 
DECLARE 
    policy_record RECORD;
BEGIN
    -- Drop all existing policies on schools table
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'schools' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.schools', policy_record.policyname);
    END LOOP;
END $$;

-- Now create the comprehensive secure policy
CREATE POLICY "Secure territory based school access"
ON public.schools FOR SELECT
USING (
  -- Superadmins have full access
  is_superadmin(auth.uid()) OR
  -- Managers must have appropriate access level and territory permissions
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Maintain existing update/insert/delete policies
CREATE POLICY "Managers can insert schools with territory check"
ON public.schools FOR INSERT
WITH CHECK (is_manager_or_superadmin() AND can_access_school_data(district));

CREATE POLICY "Managers can update schools with territory check"
ON public.schools FOR UPDATE
USING (is_manager_or_superadmin() AND can_access_school_data(district))
WITH CHECK (is_manager_or_superadmin() AND can_access_school_data(district));

CREATE POLICY "Only superadmins can delete schools"
ON public.schools FOR DELETE
USING (is_superadmin(auth.uid()));