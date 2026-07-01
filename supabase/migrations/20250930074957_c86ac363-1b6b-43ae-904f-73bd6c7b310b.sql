-- Update olympiad subjects to use descriptive subject codes instead of numerical ones
-- This makes the bulk upload process much more user-friendly

UPDATE public.olympiad_subjects 
SET subject_code = 'EPO' 
WHERE subject_name = 'English Plus Olympiad' AND subject_code = '1';

UPDATE public.olympiad_subjects 
SET subject_code = 'MPO' 
WHERE subject_name = 'Maths Plus Olympiad' AND subject_code = '2';

UPDATE public.olympiad_subjects 
SET subject_code = 'SPO' 
WHERE subject_name = 'Science Plus Olympiad' AND subject_code = '3';

UPDATE public.olympiad_subjects 
SET subject_code = 'GKPO' 
WHERE subject_name = 'GK Plus Olympiad' AND subject_code = '4';

UPDATE public.olympiad_subjects 
SET subject_code = 'KidsPO' 
WHERE subject_name = 'Kids Plus Olympiad' AND subject_code = '5';