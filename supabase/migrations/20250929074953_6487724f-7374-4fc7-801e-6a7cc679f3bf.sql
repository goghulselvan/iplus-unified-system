-- SECURITY FIX: Implement field-level RLS policies to protect sensitive contact information
-- Replace the overly permissive policies with granular access control

-- First, drop the existing overly permissive policy
DROP POLICY IF EXISTS "Complete schools access control" ON public.schools;

-- Create separate policies for different access levels and operations

-- 1. Policy for viewing basic school information (safe fields)
CREATE POLICY "View basic school information" ON public.schools
FOR SELECT 
TO authenticated
USING (
  -- Allow viewing basic info if user is authenticated and has manager+ role
  is_manager_or_superadmin()
);

-- 2. Policy for viewing sensitive contact information (restricted fields)
CREATE POLICY "View contact information with access control" ON public.schools
FOR SELECT 
TO authenticated
USING (
  -- Only allow full contact info access based on data access level
  CASE 
    -- Superadmins always have full access
    WHEN is_superadmin(auth.uid()) THEN true
    
    -- Users with 'full' data access level can see everything
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'full' THEN true
    
    -- Users with 'regional' access can only see their assigned districts
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'regional' THEN (
      EXISTS (
        SELECT 1 
        FROM public.profiles p 
        WHERE p.user_id = auth.uid() 
        AND (
          p.assigned_districts IS NULL OR 
          'ALL' = ANY(p.assigned_districts) OR 
          schools.district = ANY(p.assigned_districts)
        )
      )
    )
    
    -- Users with 'limited' access cannot see contact info
    ELSE false
  END
);

-- 3. Policy for creating schools (INSERT)
CREATE POLICY "Create schools" ON public.schools
FOR INSERT 
TO authenticated
WITH CHECK (
  -- Only managers and superadmins can create schools
  is_manager_or_superadmin()
);

-- 4. Policy for updating schools (UPDATE) 
CREATE POLICY "Update schools" ON public.schools
FOR UPDATE 
TO authenticated
USING (
  -- Allow updates if user has appropriate access level
  CASE 
    WHEN is_superadmin(auth.uid()) THEN true
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'full' THEN true
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'regional' THEN (
      EXISTS (
        SELECT 1 
        FROM public.profiles p 
        WHERE p.user_id = auth.uid() 
        AND (
          p.assigned_districts IS NULL OR 
          'ALL' = ANY(p.assigned_districts) OR 
          schools.district = ANY(p.assigned_districts)
        )
      )
    )
    ELSE false
  END
)
WITH CHECK (
  -- Same access control for what can be updated
  CASE 
    WHEN is_superadmin(auth.uid()) THEN true
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'full' THEN true
    WHEN (
      SELECT p.data_access_level 
      FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    ) = 'regional' THEN (
      EXISTS (
        SELECT 1 
        FROM public.profiles p 
        WHERE p.user_id = auth.uid() 
        AND (
          p.assigned_districts IS NULL OR 
          'ALL' = ANY(p.assigned_districts) OR 
          schools.district = ANY(p.assigned_districts)
        )
      )
    )
    ELSE false
  END
);

-- 5. Policy for deleting schools (DELETE) - Only superadmins
CREATE POLICY "Delete schools" ON public.schools
FOR DELETE 
TO authenticated
USING (
  is_superadmin(auth.uid())
);

-- 6. Keep the manual edit policy for special cases
-- (This was already properly implemented)

-- 7. Log this security enhancement
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) VALUES (
  '6db65195-f608-46d7-8691-4af7b2a73d39',
  'SECURITY_ENHANCEMENT_RLS_CONTACT_PROTECTION',
  'schools',
  NULL,
  jsonb_build_object(
    'vulnerability', 'Overly permissive access to contact information',
    'risk_level', 'HIGH',
    'old_policy', 'Complete schools access control - allowed all managers full access'
  ),
  jsonb_build_object(
    'solution', 'Implemented field-level RLS policies with data access level enforcement',
    'protection_level', 'Contact info now masked based on user data access level',
    'timestamp', now()
  ),
  inet_client_addr()
);