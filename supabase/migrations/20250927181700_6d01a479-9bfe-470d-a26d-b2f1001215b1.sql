-- Fix district name inconsistencies for Tamil Nadu using the proper update function
-- First fix the districts table
UPDATE public.districts 
SET district_name = 'KANNIYAKUMARI'
WHERE district_name = 'KANYAKUMARI' 
AND state_id = (SELECT id FROM public.states WHERE state_name ILIKE '%tamil nadu%');

-- Fix other district name variations  
UPDATE public.districts 
SET district_name = 'KANCHIPURAM'
WHERE district_name = 'KANCHEEPURAM' 
AND state_id = (SELECT id FROM public.states WHERE state_name ILIKE '%tamil nadu%');

-- Fix Sivaganga spelling consistency
UPDATE public.districts 
SET district_name = 'SIVAGANGAI'
WHERE district_name = 'SIVAGANGA' 
AND state_id = (SELECT id FROM public.states WHERE state_name ILIKE '%tamil nadu%');

-- Remove the test district
DELETE FROM public.districts 
WHERE district_name = 'Test District'
AND state_id = (SELECT id FROM public.states WHERE state_name ILIKE '%tamil nadu%');

-- Now fix schools using the manual edit function to bypass protection
DO $$
DECLARE
    school_record RECORD;
BEGIN
    -- Fix KANNIYAKUMARI spelling in schools
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE district ILIKE 'KANNIYAKUMARI' 
        AND state ILIKE '%tamil%'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Kanniyakumari')
        );
    END LOOP;
    
    -- Fix KANCHEEPURAM spelling in schools
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE district ILIKE 'KANCHEEPURAM' 
        AND state ILIKE '%tamil%'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Kancheepuram')
        );
    END LOOP;
END $$;

-- Function to normalize district names for consistent matching
CREATE OR REPLACE FUNCTION public.normalize_district_name(input_district text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF input_district IS NULL OR trim(input_district) = '' THEN
    RETURN input_district;
  END IF;
  
  -- Apply common district name corrections for Tamil Nadu
  CASE upper(trim(input_district))
    WHEN 'KANYAKUMARI' THEN RETURN 'Kanniyakumari';
    WHEN 'KANNIYAKUMARI' THEN RETURN 'Kanniyakumari'; 
    WHEN 'KANCHEEPURAM' THEN RETURN 'Kancheepuram';
    WHEN 'KANCHIPURAM' THEN RETURN 'Kancheepuram';
    WHEN 'SIVAGANGA' THEN RETURN 'Sivagangai';
    WHEN 'SIVAGANGAI' THEN RETURN 'Sivagangai';
    WHEN 'NILGIRIS' THEN RETURN 'The Nilgiris';
    WHEN 'THE NILGIRIS' THEN RETURN 'The Nilgiris';
    ELSE 
      -- Default: return in title case
      RETURN initcap(trim(input_district));
  END CASE;
END;
$$;