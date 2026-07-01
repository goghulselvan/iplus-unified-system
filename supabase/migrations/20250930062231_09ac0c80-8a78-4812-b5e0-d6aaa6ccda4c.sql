-- Complete cleanup of all student registration data
DELETE FROM public.student_subjects;
DELETE FROM public.student_registrations;
DELETE FROM public.student_registration_sequences;

-- Also clean up any orphaned results
DELETE FROM public.olympiad_results;

-- Log the cleanup
SELECT public.log_security_action(
  'COMPLETE_DATABASE_CLEANUP',
  'student_registrations',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'final_cleanup',
    'tables_cleared', ARRAY['student_registrations', 'student_subjects', 'student_registration_sequences', 'olympiad_results']
  )
);