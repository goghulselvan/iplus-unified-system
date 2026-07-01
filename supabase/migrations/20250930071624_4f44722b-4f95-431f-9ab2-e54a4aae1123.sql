-- Delete all existing student registrations and related data
DELETE FROM public.student_subjects;
DELETE FROM public.student_registrations;
DELETE FROM public.student_registration_sequences;

-- Also clean up school codes and district codes that were auto-generated
DELETE FROM public.school_codes;
-- Reset district codes to keep only pre-existing ones from before today
DELETE FROM public.district_codes WHERE created_at >= CURRENT_DATE;