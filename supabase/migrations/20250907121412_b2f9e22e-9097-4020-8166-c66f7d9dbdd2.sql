-- Fix is_role_unchanged function search path mutable security issue
CREATE OR REPLACE FUNCTION public.is_role_unchanged()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Only allow role changes if the user is a superadmin
  IF OLD.role != NEW.role AND NOT is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Role changes not permitted';
  END IF;
  RETURN NEW;
END;
$function$;