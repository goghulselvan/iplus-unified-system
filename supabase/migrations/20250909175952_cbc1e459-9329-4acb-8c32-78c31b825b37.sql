-- Delete all student registrations and related data for deployment reset
-- First delete student subjects (foreign key constraint)
DELETE FROM public.student_subjects;

-- Then delete all student registrations
DELETE FROM public.student_registrations;

-- Delete any olympiad results
DELETE FROM public.olympiad_results;

-- Reset sequence counters (already done but ensuring it's clean)
DELETE FROM public.student_registration_sequences;

-- Log the complete data reset
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) VALUES (
  'b83d0806-fe01-4478-9d81-a9817b15e0cf',
  'DEPLOYMENT_DATA_RESET',
  'student_registrations',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Complete student data reset for deployment',
    'timestamp', now(),
    'tables_cleared', ARRAY['student_subjects', 'student_registrations', 'olympiad_results', 'student_registration_sequences']
  ),
  NULL
);