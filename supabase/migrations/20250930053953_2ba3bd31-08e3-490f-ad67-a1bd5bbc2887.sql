-- Clear all student registration data for fresh start
-- This will delete all student registrations, their subjects, and reset sequences

-- Delete all student subjects first (foreign key dependency)
DELETE FROM public.student_subjects;

-- Delete all student registrations
DELETE FROM public.student_registrations;

-- Reset all registration sequences
DELETE FROM public.student_registration_sequences;

-- Log the cleanup operation
SELECT public.log_security_action(
  'BULK_DELETE_ALL_REGISTRATIONS',
  'student_registrations',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'database_cleanup',
    'reason', 'Fresh start requested by user',
    'cleared_tables', ARRAY['student_registrations', 'student_subjects', 'student_registration_sequences']
  )
);