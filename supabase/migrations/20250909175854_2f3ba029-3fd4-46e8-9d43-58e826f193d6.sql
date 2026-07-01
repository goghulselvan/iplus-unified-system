-- Reset the generation process for deployment
-- Clear all sequence counters to start fresh
DELETE FROM public.student_registration_sequences;

-- Clean up any remaining test registrations (in case any were missed)
DELETE FROM public.student_subjects 
WHERE registration_id IN (
  SELECT id FROM public.student_registrations 
  WHERE student_name ILIKE '%test%' OR student_name ILIKE '%sample%'
);

DELETE FROM public.student_registrations 
WHERE student_name ILIKE '%test%' or student_name ILIKE '%sample%';

-- Insert a deployment reset log entry
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) VALUES (
  'b83d0806-fe01-4478-9d81-a9817b15e0cf', -- Default system user
  'DEPLOYMENT_RESET',
  'student_registration_sequences',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Reset sequence counters for deployment',
    'timestamp', now()
  ),
  NULL
);