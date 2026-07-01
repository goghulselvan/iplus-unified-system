-- Fix the search path security warning for the functions
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role 
LANGUAGE SQL 
SECURITY DEFINER 
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_superadmin()
RETURNS boolean 
LANGUAGE SQL 
SECURITY DEFINER 
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE user_id = auth.uid()) 
    IN ('manager'::user_role, 'superadmin'::user_role), 
    false
  );
$$;