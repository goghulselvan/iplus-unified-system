-- Fix critical security vulnerability: Student Academic Performance Could Be Leaked
-- Implement school-level and district-level access restrictions for olympiad results

-- Create function to check if user can access student results from a specific school
CREATE OR REPLACE FUNCTION public.can_access_student_results(p_school_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_profile RECORD;
  school_district TEXT;
BEGIN
  -- Get user profile with access permissions
  SELECT assigned_districts, data_access_level, role 
  INTO user_profile
  FROM public.profiles 
  WHERE user_id = auth.uid();
  
  -- If no profile found, deny access
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Superadmins have full access to all results
  IF user_profile.role = 'superadmin' THEN
    RETURN true;
  END IF;
  
  -- Get the school's district
  SELECT district INTO school_district
  FROM public.schools
  WHERE id = p_school_id;
  
  -- If school not found, deny access
  IF school_district IS NULL THEN
    RETURN false;
  END IF;
  
  -- Users with full access level can see all results
  IF user_profile.data_access_level = 'full' THEN
    RETURN true;
  END IF;
  
  -- Handle 'ALL' districts assignment (legacy compatibility)
  IF user_profile.assigned_districts IS NOT NULL AND 'ALL' = ANY(user_profile.assigned_districts) THEN
    RETURN true;
  END IF;
  
  -- Regional access - check if district is in assigned districts
  IF user_profile.data_access_level = 'regional' AND user_profile.assigned_districts IS NOT NULL THEN
    RETURN school_district = ANY(user_profile.assigned_districts);
  END IF;
  
  -- Limited access users cannot see student results at all
  IF user_profile.data_access_level = 'limited' THEN
    RETURN false;
  END IF;
  
  -- Default deny for any other cases
  RETURN false;
END;
$$;

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Managers can manage olympiad results" ON public.olympiad_results;
DROP POLICY IF EXISTS "Managers can view olympiad results" ON public.olympiad_results;

-- Create new restrictive policies for olympiad results access

-- Policy for viewing olympiad results (SELECT)
CREATE POLICY "Restricted access to view olympiad results"
ON public.olympiad_results
FOR SELECT
TO authenticated
USING (
  -- Must be authenticated and have manager+ privileges
  is_manager_or_superadmin() AND
  -- Must have access to the specific school's results
  EXISTS (
    SELECT 1 FROM public.student_registrations sr
    WHERE sr.id = olympiad_results.registration_id
    AND can_access_student_results(sr.school_id)
  )
);

-- Policy for inserting olympiad results (INSERT)
CREATE POLICY "Managers can create olympiad results for accessible schools"
ON public.olympiad_results
FOR INSERT
TO authenticated
WITH CHECK (
  -- Must be authenticated and have manager+ privileges
  is_manager_or_superadmin() AND
  -- Must be the creator
  auth.uid() = created_by AND
  -- Must have access to the specific school
  EXISTS (
    SELECT 1 FROM public.student_registrations sr
    WHERE sr.id = olympiad_results.registration_id
    AND can_access_student_results(sr.school_id)
  )
);

-- Policy for updating olympiad results (UPDATE)
CREATE POLICY "Managers can update olympiad results for accessible schools"
ON public.olympiad_results
FOR UPDATE
TO authenticated
USING (
  -- Must be authenticated and have manager+ privileges
  is_manager_or_superadmin() AND
  -- Must have access to the specific school
  EXISTS (
    SELECT 1 FROM public.student_registrations sr
    WHERE sr.id = olympiad_results.registration_id
    AND can_access_student_results(sr.school_id)
  )
)
WITH CHECK (
  -- Must maintain manager+ privileges and school access
  is_manager_or_superadmin() AND
  EXISTS (
    SELECT 1 FROM public.student_registrations sr
    WHERE sr.id = olympiad_results.registration_id
    AND can_access_student_results(sr.school_id)
  )
);

-- Policy for deleting olympiad results (DELETE) - Only superadmins
CREATE POLICY "Only superadmins can delete olympiad results"
ON public.olympiad_results
FOR DELETE
TO authenticated
USING (
  -- Only superadmins can delete results
  is_superadmin(auth.uid())
);

-- Create audit logging function for student results access
CREATE OR REPLACE FUNCTION public.audit_student_results_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school_info RECORD;
BEGIN
  -- Get school information for logging
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT s.school_name, s.district, s.state INTO school_info
    FROM public.schools s
    JOIN public.student_registrations sr ON s.id = sr.school_id
    WHERE sr.id = NEW.registration_id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT s.school_name, s.district, s.state INTO school_info
    FROM public.schools s
    JOIN public.student_registrations sr ON s.id = sr.school_id
    WHERE sr.id = OLD.registration_id;
  END IF;
  
  -- Log access to sensitive student performance data
  PERFORM public.log_sensitive_data_access(
    'olympiad_results',
    TG_OP || '_STUDENT_RESULTS',
    1,
    ARRAY['marks_obtained', 'percentage', 'rank_in_school', 'rank_in_district', 'rank_overall'],
    format('Access to student results from %s (%s, %s)', 
           COALESCE(school_info.school_name, 'Unknown School'),
           COALESCE(school_info.district, 'Unknown District'),
           COALESCE(school_info.state, 'Unknown State')
    )
  );
  
  RETURN CASE 
    WHEN TG_OP = 'DELETE' THEN OLD
    ELSE NEW
  END;
END;
$$;

-- Create trigger to audit student results access
CREATE TRIGGER audit_olympiad_results_access
AFTER INSERT OR UPDATE OR DELETE ON public.olympiad_results
FOR EACH ROW EXECUTE FUNCTION public.audit_student_results_access();

-- Log this security fix
PERFORM public.log_security_action(
  'SECURITY_FIX_APPLIED',
  'olympiad_results',
  NULL,
  NULL,
  jsonb_build_object(
    'fix_type', 'Student Academic Performance Access Control',
    'description', 'Implemented school-level and district-level access restrictions',
    'policies_created', 4,
    'audit_enabled', true,
    'applied_at', now()
  )
);