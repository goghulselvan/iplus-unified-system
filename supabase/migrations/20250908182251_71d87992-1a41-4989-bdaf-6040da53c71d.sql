-- Standardize all Puducherry schools to have state = 'Puducherry' and district = 'Puducherry'
UPDATE public.schools 
SET state = 'Puducherry', district = 'Puducherry'
WHERE LOWER(district) LIKE '%puducherry%' OR LOWER(state) LIKE '%puducherry%';

-- Ensure there's a district code for Puducherry 
-- This will create district code 001 for Puducherry under state code 34
INSERT INTO public.district_codes (state_code, district_name, district_code)
VALUES ('34', 'Puducherry', '001')
ON CONFLICT (state_code, district_name) DO NOTHING;

-- Log this standardization action
SELECT public.log_security_action(
  'PUDUCHERRY_STANDARDIZATION',
  'schools',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Standardized all Puducherry schools to state=Puducherry, district=Puducherry',
    'affected_schools', (SELECT COUNT(*) FROM public.schools WHERE state = 'Puducherry' AND district = 'Puducherry'),
    'timestamp', now()
  )
);