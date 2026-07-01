-- Fix RLS policies for manual school edits by managers
-- First, ensure the function can be executed by all authenticated users
GRANT EXECUTE ON FUNCTION public.update_school_with_manual_edit(uuid, jsonb) TO authenticated;

-- Also grant on the regular schools table updates for managers
CREATE POLICY "Managers can manually edit protected fields" 
ON public.schools 
FOR UPDATE 
USING (
  is_manager_or_superadmin() 
  AND COALESCE(current_setting('app.manual_edit_mode', true), 'false')::boolean = true
)
WITH CHECK (
  is_manager_or_superadmin() 
  AND COALESCE(current_setting('app.manual_edit_mode', true), 'false')::boolean = true
);

-- Update the existing policy to be more permissive for managers
DROP POLICY IF EXISTS "Complete schools access control" ON public.schools;

CREATE POLICY "Complete schools access control" 
ON public.schools 
FOR ALL 
USING (is_manager_or_superadmin())
WITH CHECK (is_manager_or_superadmin());