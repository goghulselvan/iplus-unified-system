-- Restore registration status to what it was up to September 27th, 2025

-- Update schools to "In Progress" status (37 schools)
UPDATE public.schools 
SET registration_status = 'In Progress', updated_at = now()
WHERE ss_no IN (112, 120, 121, 143, 148, 158, 171, 179, 180, 186, 188, 189, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216);

-- Update schools to "Confirmed" status (28 schools)  
UPDATE public.schools 
SET registration_status = 'Confirmed', updated_at = now()
WHERE ss_no IN (167, 843, 882, 1243, 1438, 1470, 1491, 1516, 1571, 2026, 2131, 2213, 2492, 2544, 2647, 2981, 3075, 3098, 3661, 4267, 4780, 5416, 5875, 6504, 6935, 7070, 7223, 7619);