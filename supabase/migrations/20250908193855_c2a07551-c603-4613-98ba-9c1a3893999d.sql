-- Fix critical security functions identified by linter
-- Add search_path parameter to security functions to prevent search path injection

-- Update is_superadmin function
CREATE OR REPLACE FUNCTION public.is_superadmin(user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = user_uuid 
    AND role = 'superadmin'
  );
$$;

-- Update is_manager_or_superadmin function  
CREATE OR REPLACE FUNCTION public.is_manager_or_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role IN ('manager', 'superadmin')
  );
$$;

-- Update is_superadmin_with_ip_check function
CREATE OR REPLACE FUNCTION public.is_superadmin_with_ip_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'
  );
$$;