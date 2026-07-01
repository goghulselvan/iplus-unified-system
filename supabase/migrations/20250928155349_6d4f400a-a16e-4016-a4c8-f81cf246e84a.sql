-- Final cleanup to ensure completely fresh start for registration numbers
-- Clean up any remaining sequences
DELETE FROM public.student_registration_sequences;

-- Clean up any existing school codes to ensure fresh assignment
DELETE FROM public.school_codes;

-- Reset any registration number fields in schools to NULL (if they exist)
UPDATE public.schools 
SET registration_status = 'Pending', 
    name_list_status = 'Pending'
WHERE registration_status != 'Pending' OR name_list_status != 'Pending';

-- Log the cleanup
SELECT 'All registration data cleaned and reset for fresh start' as status;