-- Create security definer function to check user role (prevents RLS recursion issues)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Create function to check if user is manager or superadmin
CREATE OR REPLACE FUNCTION public.is_manager_or_superadmin()
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE user_id = auth.uid()) 
    IN ('manager'::user_role, 'superadmin'::user_role), 
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Drop existing policies and recreate with stronger security
DROP POLICY IF EXISTS "Only managers and superadmins can view schools" ON public.schools;
DROP POLICY IF EXISTS "Only managers and superadmins can insert schools" ON public.schools;
DROP POLICY IF EXISTS "Managers and superadmins can update schools" ON public.schools;
DROP POLICY IF EXISTS "Only superadmins can delete schools" ON public.schools;

-- Recreate school policies with security definer functions
CREATE POLICY "Only authenticated managers and superadmins can view schools" 
ON public.schools 
FOR SELECT 
TO authenticated
USING (public.is_manager_or_superadmin());

CREATE POLICY "Only authenticated managers and superadmins can insert schools" 
ON public.schools 
FOR INSERT 
TO authenticated
WITH CHECK (public.is_manager_or_superadmin());

CREATE POLICY "Only authenticated managers and superadmins can update schools" 
ON public.schools 
FOR UPDATE 
TO authenticated
USING (public.is_manager_or_superadmin())
WITH CHECK (public.is_manager_or_superadmin());

CREATE POLICY "Only authenticated superadmins can delete schools" 
ON public.schools 
FOR DELETE 
TO authenticated
USING (public.get_current_user_role() = 'superadmin'::user_role);

-- Strengthen activity_logs policies 
DROP POLICY IF EXISTS "Authenticated users can view activity_logs" ON public.activity_logs;
CREATE POLICY "Only managers and superadmins can view activity_logs" 
ON public.activity_logs 
FOR SELECT 
TO authenticated
USING (public.is_manager_or_superadmin());

-- Strengthen communications policies
DROP POLICY IF EXISTS "Authenticated users can view communications" ON public.communications;
CREATE POLICY "Only managers and superadmins can view communications" 
ON public.communications 
FOR SELECT 
TO authenticated
USING (public.is_manager_or_superadmin());

-- Strengthen workflow_history policies
DROP POLICY IF EXISTS "Authenticated users can view workflow_history" ON public.workflow_history;
CREATE POLICY "Only managers and superadmins can view workflow_history" 
ON public.workflow_history 
FOR SELECT 
TO authenticated
USING (public.is_manager_or_superadmin());

-- Ensure RLS is enabled on all sensitive tables
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;