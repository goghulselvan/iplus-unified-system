-- Fix infinite recursion in profiles RLS policies
-- Drop existing problematic policies
DROP POLICY IF EXISTS "Superadmins can do everything on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create non-recursive policies using security definer function
CREATE OR REPLACE FUNCTION public.is_superadmin(user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE user_id = user_uuid AND role = 'superadmin'::user_role
  );
$$;

-- Create proper RLS policies
CREATE POLICY "Users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Superadmins can do everything on profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (public.is_superadmin(auth.uid()));

-- Allow profile creation for new users
CREATE POLICY "Allow profile creation"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);