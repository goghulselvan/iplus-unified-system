-- Reset school code and student registration system for fresh start

-- 1. Delete all student registrations and related data (test data cleanup)
DELETE FROM public.student_subjects;
DELETE FROM public.student_registrations;

-- 2. Reset all student registration sequences to start fresh
DELETE FROM public.student_registration_sequences;

-- 3. Reset school codes to start from 001 again
DELETE FROM public.school_codes;

-- Note: Keeping state_codes and district_codes structure intact
-- School codes will now start from 001 for each district when new schools register
-- Student registration sequences will start fresh when new students are registered