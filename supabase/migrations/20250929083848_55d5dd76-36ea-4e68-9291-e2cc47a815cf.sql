-- Fix search_path for the functions we just created
CREATE OR REPLACE FUNCTION public.safe_boolean_cast(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
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

-- Fix search_path for validation triggers
CREATE OR REPLACE FUNCTION public.validate_state_lookup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_district_lookup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_olympiad_subject_lookup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure is_active is never set to NULL from empty string
  IF NEW.is_active IS NULL THEN
    NEW.is_active := true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Also fix the class formatting issue in get_class_code function to handle padded numbers
CREATE OR REPLACE FUNCTION public.get_class_code(p_student_class text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Convert class names to numeric codes for registration numbers
  -- Handle both old format (1, 2, 3) and new format (01, 02, 03)
  CASE UPPER(TRIM(p_student_class))
    WHEN '1', '01', 'CLASS 1', 'I' THEN RETURN 1;
    WHEN '2', '02', 'CLASS 2', 'II' THEN RETURN 2;
    WHEN '3', '03', 'CLASS 3', 'III' THEN RETURN 3;
    WHEN '4', '04', 'CLASS 4', 'IV' THEN RETURN 4;
    WHEN '5', '05', 'CLASS 5', 'V' THEN RETURN 5;
    WHEN '6', '06', 'CLASS 6', 'VI' THEN RETURN 6;
    WHEN '7', '07', 'CLASS 7', 'VII' THEN RETURN 7;
    WHEN '8', '08', 'CLASS 8', 'VIII' THEN RETURN 8;
    WHEN '9', '09', 'CLASS 9', 'IX' THEN RETURN 9;
    WHEN '10', 'CLASS 10', 'X' THEN RETURN 10;
    WHEN '11', 'CLASS 11', 'XI' THEN RETURN 11;
    WHEN '12', 'CLASS 12', 'XII' THEN RETURN 12;
    WHEN 'UKG', 'UPPER KG' THEN RETURN 14;
    WHEN 'LKG', 'LOWER KG' THEN RETURN 15;
    WHEN 'NURSERY', 'PRE-K' THEN RETURN 16;
    ELSE RETURN 99; -- Default for unknown classes
  END CASE;
END;
$$;