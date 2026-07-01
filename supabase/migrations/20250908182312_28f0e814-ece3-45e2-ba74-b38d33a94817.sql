-- Standardize all Puducherry schools to have state = 'Puducherry' and district = 'Puducherry'
UPDATE public.schools 
SET state = 'Puducherry', district = 'Puducherry'
WHERE LOWER(district) LIKE '%puducherry%' OR LOWER(state) LIKE '%puducherry%';

-- Check if district code for Puducherry already exists, if not create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.district_codes 
    WHERE state_code = '34' AND district_name = 'Puducherry'
  ) THEN
    INSERT INTO public.district_codes (state_code, district_name, district_code)
    VALUES ('34', 'Puducherry', '001');
  END IF;
END $$;