-- Fix security vulnerability: Restrict school data access to managers and superadmins only
DROP POLICY IF EXISTS "Authenticated users can view schools" ON public.schools;

-- Create new restrictive policy for viewing schools
CREATE POLICY "Only managers and superadmins can view schools" 
ON public.schools 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE profiles.user_id = auth.uid() 
    AND profiles.role = ANY (ARRAY['manager'::user_role, 'superadmin'::user_role])
  )
);

-- Also restrict school creation to managers and superadmins for consistency
DROP POLICY IF EXISTS "Authenticated users can insert schools" ON public.schools;

CREATE POLICY "Only managers and superadmins can insert schools" 
ON public.schools 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE profiles.user_id = auth.uid() 
    AND profiles.role = ANY (ARRAY['manager'::user_role, 'superadmin'::user_role])
  )
);