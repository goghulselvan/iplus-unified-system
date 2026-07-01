-- Update school records to use standardized district names for Tamil Nadu
-- This will fix the dropdown showing old district names

-- Standardize Nilgiris variations to NILGIRIS
UPDATE public.schools 
SET district = 'NILGIRIS'
WHERE state = 'TAMIL NADU' 
  AND district IN ('The Nilgiris', 'THE NILGIRIS', 'Nilgiris');

-- Standardize Kanniyakumari variations to KANNIYAKUMARI  
UPDATE public.schools 
SET district = 'KANNIYAKUMARI'
WHERE state = 'TAMIL NADU' 
  AND district IN ('Kanniyakumari', 'KANYAKUMARI', 'Kanyakumari');

-- Log the changes for verification
SELECT 'Updated school districts' as action, 
       COUNT(*) as affected_schools 
FROM public.schools 
WHERE state = 'TAMIL NADU' 
  AND district IN ('NILGIRIS', 'KANNIYAKUMARI');