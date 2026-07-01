-- Update all Mahe, Yanam, and Karaikal schools to have state = 'Puducherry'
UPDATE public.schools 
SET state = 'Puducherry'
WHERE LOWER(district) IN ('mahe', 'yanam', 'karaikal');

-- Create district codes for all Puducherry territories
-- Check if district codes exist, if not create them
DO $$
BEGIN
  -- Mahe (district code 002)
  IF NOT EXISTS (
    SELECT 1 FROM public.district_codes 
    WHERE state_code = '34' AND district_name = 'Mahe'
  ) THEN
    INSERT INTO public.district_codes (state_code, district_name, district_code)
    VALUES ('34', 'Mahe', '002');
  END IF;
  
  -- Yanam (district code 003)
  IF NOT EXISTS (
    SELECT 1 FROM public.district_codes 
    WHERE state_code = '34' AND district_name = 'Yanam'
  ) THEN
    INSERT INTO public.district_codes (state_code, district_name, district_code)
    VALUES ('34', 'Yanam', '003');
  END IF;
  
  -- Karaikal (district code 004)
  IF NOT EXISTS (
    SELECT 1 FROM public.district_codes 
    WHERE state_code = '34' AND district_name = 'Karaikal'
  ) THEN
    INSERT INTO public.district_codes (state_code, district_name, district_code)
    VALUES ('34', 'Karaikal', '004');
  END IF;
END $$;