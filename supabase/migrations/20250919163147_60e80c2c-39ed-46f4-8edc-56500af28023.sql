-- Fix the KANNIYAKUMARI district code issue
-- Update KANNIYAKUMARI from code 039 to 011 and ensure NILGIRIS has code 018

-- First, check if code 011 exists and delete it if it conflicts
DELETE FROM public.district_codes 
WHERE state_code = '33' AND district_code = '011' AND district_name != 'KANNIYAKUMARI';

-- Update KANNIYAKUMARI to use the correct code 011
UPDATE public.district_codes 
SET district_code = '011'
WHERE state_code = '33' AND district_name = 'KANNIYAKUMARI' AND district_code = '039';

-- Ensure NILGIRIS has the correct code 018 (check if it exists)
INSERT INTO public.district_codes (state_code, district_name, district_code)
VALUES ('33', 'NILGIRIS', '018')
ON CONFLICT (state_code, district_code) DO UPDATE SET district_name = 'NILGIRIS';

-- Clear school codes for KANNIYAKUMARI schools so they get reassigned with correct district code
DELETE FROM public.school_codes 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE s.state = 'TAMIL NADU' AND s.district = 'KANNIYAKUMARI'
);

-- Clear student registration sequences to reset numbering
DELETE FROM public.student_registration_sequences 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE s.state = 'TAMIL NADU' AND s.district = 'KANNIYAKUMARI'
);

-- Verify the final state
SELECT state_code, district_name, district_code 
FROM public.district_codes 
WHERE state_code = '33' AND district_name IN ('KANNIYAKUMARI', 'NILGIRIS')
ORDER BY district_code;