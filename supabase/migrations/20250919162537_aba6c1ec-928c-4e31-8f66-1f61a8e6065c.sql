-- Use the safe manual edit function to update district names
-- This bypasses the protection for bulk standardization

-- Get all schools that need district name updates
WITH schools_to_update AS (
  SELECT id
  FROM public.schools 
  WHERE state = 'TAMIL NADU' 
    AND district IN ('The Nilgiris', 'THE NILGIRIS', 'Nilgiris', 'Kanniyakumari', 'KANYAKUMARI', 'Kanyakumari')
)
SELECT 
  s.id,
  s.district as old_district,
  CASE 
    WHEN s.district IN ('The Nilgiris', 'THE NILGIRIS', 'Nilgiris') THEN 'NILGIRIS'
    WHEN s.district IN ('Kanniyakumari', 'KANYAKUMARI', 'Kanyakumari') THEN 'KANNIYAKUMARI'
    ELSE s.district
  END as new_district
FROM public.schools s
WHERE s.id IN (SELECT id FROM schools_to_update)
ORDER BY s.district;