-- Fix critical security issue: Restrict profile visibility
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create new restricted policy for profile viewing
CREATE POLICY "Users can view own profile, managers can view all" 
ON public.profiles 
FOR SELECT 
USING (
  auth.uid() = user_id OR 
  is_manager_or_superadmin()
);

-- Add policy to allow users to see profile info in communications context
CREATE POLICY "Users can view profile names for communications" 
ON public.profiles 
FOR SELECT 
USING (
  auth.uid() = user_id OR 
  is_manager_or_superadmin() OR
  EXISTS (
    SELECT 1 FROM communications 
    WHERE communications.user_id = profiles.user_id
  )
);