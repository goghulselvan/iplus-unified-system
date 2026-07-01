-- Add email domain validation function and constraints
CREATE OR REPLACE FUNCTION public.validate_iplusedu_email_domain(email_address text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow null emails
  IF email_address IS NULL OR email_address = '' THEN
    RETURN true;
  END IF;
  
  -- Validate email format and domain
  RETURN email_address ~* '^[A-Za-z0-9._%+-]+@iplusedu\.in$';
END;
$function$;

-- Add check constraint to profiles table for email domain validation
ALTER TABLE public.profiles 
ADD CONSTRAINT check_email_domain 
CHECK (validate_iplusedu_email_domain(email));

-- Update handle_new_user function to validate email domain
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  user_email TEXT;
BEGIN
  -- Get user email from auth.users
  user_email := NEW.email;
  
  -- Validate email domain
  IF user_email IS NOT NULL AND NOT validate_iplusedu_email_domain(user_email) THEN
    RAISE EXCEPTION 'Registration restricted to iplusedu.in domain only';
  END IF;
  
  -- Count existing profiles
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  
  -- Insert new profile with validated email
  INSERT INTO public.profiles (user_id, username, full_name, role, email)
  VALUES (
    NEW.id, 
    NEW.raw_user_meta_data ->> 'username',
    NEW.raw_user_meta_data ->> 'full_name',
    CASE WHEN user_count = 0 THEN 'superadmin'::user_role ELSE 'manager'::user_role END,
    user_email
  );
  
  RETURN NEW;
END;
$function$;