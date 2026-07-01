-- Reset registration number generation for fresh start
-- Clear test data and reset sequences

-- Delete test student registrations (from test school with SS no 0000)
DELETE FROM public.student_subjects 
WHERE registration_id IN (
  SELECT sr.id FROM public.student_registrations sr
  JOIN public.schools s ON sr.school_id = s.id
  WHERE s.ss_no = 0
);

DELETE FROM public.student_registrations 
WHERE school_id IN (
  SELECT id FROM public.schools WHERE ss_no = 0
);

-- Reset all student registration sequences to start fresh from 001
DELETE FROM public.student_registration_sequences;

-- Clear school codes for Tamil Nadu schools so they get reassigned fresh
DELETE FROM public.school_codes 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE s.state = 'TAMIL NADU'
);

-- Log the reset action
SELECT 'Registration sequences reset - next registrations will start from 001' as status;