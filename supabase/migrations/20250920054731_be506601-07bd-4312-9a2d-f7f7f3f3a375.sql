-- Reset school code and student registration system for fresh start

-- 1. Delete all student registrations and related data (test data cleanup)
DELETE FROM public.student_subjects;
DELETE FROM public.student_registrations;

-- 2. Reset all student registration sequences to start fresh
DELETE FROM public.student_registration_sequences;

-- 3. Reset school codes to start from 001 again
DELETE FROM public.school_codes;

-- 4. Reset district codes to ensure fresh district numbering
-- Keep the district_codes table structure but reset sequences
-- Note: We'll keep state_codes as they should remain constant

-- Add a comment to track this reset
INSERT INTO public.security_audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
VALUES (
  auth.uid(),
  'SYSTEM_RESET_FOR_PRODUCTION',
  'system_wide',
  NULL,
  jsonb_build_object('action', 'test_data_cleanup'),
  jsonb_build_object(
    'reset_items', jsonb_build_array(
      'student_registrations',
      'student_subjects', 
      'student_registration_sequences',
      'school_codes'
    ),
    'reason', 'Preparing system for real school registrations',
    'timestamp', now()
  ),
  inet_client_addr()
);