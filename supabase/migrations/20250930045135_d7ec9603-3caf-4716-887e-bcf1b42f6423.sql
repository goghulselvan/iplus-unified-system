-- Remove triggers first, then functions
DROP TRIGGER IF EXISTS validate_state_lookup_trigger ON state_codes;
DROP TRIGGER IF EXISTS validate_district_lookup_trigger ON district_codes;  
DROP TRIGGER IF EXISTS validate_olympiad_subject_lookup_trigger ON olympiad_subjects;

DROP FUNCTION IF EXISTS validate_state_lookup() CASCADE;
DROP FUNCTION IF EXISTS validate_district_lookup() CASCADE;
DROP FUNCTION IF EXISTS validate_olympiad_subject_lookup() CASCADE;

-- Update safe_boolean_cast to be more robust and handle edge cases
CREATE OR REPLACE FUNCTION public.safe_boolean_cast(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Handle null, empty, or whitespace-only values
  IF input_value IS NULL OR trim(input_value) = '' OR trim(input_value) = '""' THEN
    RETURN NULL;
  END IF;
  
  -- Handle common boolean representations (case insensitive)
  CASE lower(trim(input_value))
    WHEN 'true', 't', 'yes', 'y', '1', 'on' THEN RETURN true;
    WHEN 'false', 'f', 'no', 'n', '0', 'off' THEN RETURN false;
    ELSE 
      -- Return NULL for invalid values instead of throwing an error
      RETURN NULL;
  END CASE;
END;
$$;