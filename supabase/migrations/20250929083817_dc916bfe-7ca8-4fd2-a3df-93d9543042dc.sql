-- Fix boolean validation issues in bulk upload process
-- Add validation function to prevent empty strings being passed to boolean fields

CREATE OR REPLACE FUNCTION public.safe_boolean_cast(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Handle empty strings and null values
  IF input_value IS NULL OR trim(input_value) = '' THEN
    RETURN NULL;
  END IF;
  
  -- Handle common boolean representations
  CASE lower(trim(input_value))
    WHEN 'true', 't', 'yes', 'y', '1' THEN RETURN true;
    WHEN 'false', 'f', 'no', 'n', '0' THEN RETURN false;
    ELSE RETURN NULL; -- Invalid input returns NULL instead of error
  END CASE;
END;
$$;

-- Add validation trigger for state_codes to prevent empty string issues
CREATE OR REPLACE FUNCTION public.validate_state_lookup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Apply validation trigger
DROP TRIGGER IF EXISTS validate_state_lookup_trigger ON public.state_codes;
CREATE TRIGGER validate_state_lookup_trigger
  BEFORE INSERT OR UPDATE ON public.state_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_state_lookup();

-- Add similar validation for district_codes
CREATE OR REPLACE FUNCTION public.validate_district_lookup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Apply validation trigger
DROP TRIGGER IF EXISTS validate_district_lookup_trigger ON public.district_codes;
CREATE TRIGGER validate_district_lookup_trigger
  BEFORE INSERT OR UPDATE ON public.district_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_district_lookup();

-- Add validation for olympiad_subjects
CREATE OR REPLACE FUNCTION public.validate_olympiad_subject_lookup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Apply validation trigger
DROP TRIGGER IF EXISTS validate_olympiad_subject_lookup_trigger ON public.olympiad_subjects;
CREATE TRIGGER validate_olympiad_subject_lookup_trigger
  BEFORE INSERT OR UPDATE ON public.olympiad_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_olympiad_subject_lookup();