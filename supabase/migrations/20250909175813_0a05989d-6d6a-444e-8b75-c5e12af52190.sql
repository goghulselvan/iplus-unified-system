-- Reset the generation process for deployment
-- Clear all sequence counters to start fresh
DELETE FROM public.student_registration_sequences;

-- Reset any auto-increment sequences that might exist
-- This ensures registration numbers start from 001 for each school/class combination

-- Clean up any remaining test registrations (in case any were missed)
DELETE FROM public.student_subjects 
WHERE registration_id IN (
  SELECT id FROM public.student_registrations 
  WHERE student_name ILIKE '%test%' OR student_name ILIKE '%sample%'
);

DELETE FROM public.student_registrations 
WHERE student_name ILIKE '%test%' OR student_name ILIKE '%sample%';

-- Log the reset for audit purposes
PERFORM public.log_security_action(
  'DEPLOYMENT_RESET',
  'student_registration_sequences',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Reset sequence counters for deployment',
    'timestamp', now()
  )
);