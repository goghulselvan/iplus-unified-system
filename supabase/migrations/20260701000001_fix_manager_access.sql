-- Fix 1: Allow managers with 'limited' data_access_level to view schools.
-- Previously 'limited' returned false, blocking all school reads for default-created staff.
-- Export is still gated at the UI layer (superadmin only button).
CREATE OR REPLACE FUNCTION public.can_access_school_data(school_district text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_profile RECORD;
BEGIN
  SELECT assigned_districts, data_access_level, role
  INTO user_profile
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF user_profile.role = 'superadmin' THEN
    RETURN true;
  END IF;

  IF user_profile.data_access_level = 'full' THEN
    RETURN true;
  END IF;

  IF user_profile.assigned_districts IS NOT NULL AND 'ALL' = ANY(user_profile.assigned_districts) THEN
    RETURN true;
  END IF;

  IF user_profile.data_access_level = 'regional' AND school_district IS NOT NULL AND user_profile.assigned_districts IS NOT NULL THEN
    RETURN school_district = ANY(user_profile.assigned_districts);
  END IF;

  -- 'limited' managers can VIEW all schools; export is restricted in the UI.
  IF user_profile.data_access_level = 'limited' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- Fix 2: Upgrade all existing manager profiles to 'full' data_access_level
-- so they can view all schools without district restrictions.
-- Safe: only updates the access level column, no row deletes or schema changes.
UPDATE public.profiles
SET data_access_level = 'full'
WHERE role = 'manager'
  AND (data_access_level IS NULL OR data_access_level = 'limited');
