-- Fix the can_access_school_data function to properly handle access levels
CREATE OR REPLACE FUNCTION public.can_access_school_data(school_district text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_profile RECORD;
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
  
  -- Superadmins have full access
  IF user_profile.role = 'superadmin' THEN
    RETURN true;
  END IF;
  
  -- Users with full access level can see all data
  IF user_profile.data_access_level = 'full' THEN
    RETURN true;
  END IF;
  
  -- Handle 'ALL' districts assignment (legacy compatibility)
  IF user_profile.assigned_districts IS NOT NULL AND 'ALL' = ANY(user_profile.assigned_districts) THEN
    RETURN true;
  END IF;
  
  -- Regional access - check if district is in assigned districts
  IF user_profile.data_access_level = 'regional' AND school_district IS NOT NULL AND user_profile.assigned_districts IS NOT NULL THEN
    RETURN school_district = ANY(user_profile.assigned_districts);
  END IF;
  
  -- Limited access denies contact data
  IF user_profile.data_access_level = 'limited' THEN
    RETURN false;
  END IF;
  
  -- Default deny
  RETURN false;
END;
$function$;