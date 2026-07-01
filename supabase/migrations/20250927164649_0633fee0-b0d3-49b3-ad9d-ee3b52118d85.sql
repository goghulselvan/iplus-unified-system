-- Clear existing school codes to force alphabetical reassignment
DELETE FROM public.school_codes;

-- Clear existing student sequences (not needed with alphabetical system)
DELETE FROM public.student_registration_sequences;