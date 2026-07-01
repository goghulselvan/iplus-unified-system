-- Simple test data creation in smaller batches
-- Create 100 test registrations first
INSERT INTO public.student_registrations (
  project_id,
  school_id,
  student_name,
  student_class,
  created_by,
  class_code
)
SELECT 
  'da46555a-76f0-4767-890e-647896d5ff90'::uuid,
  s.id,
  'Test Student ' || LPAD(generate_series::text, 4, '0'),
  (generate_series % 8 + 1)::text,
  (SELECT user_id FROM profiles WHERE role = 'superadmin' LIMIT 1),
  generate_series % 8 + 1
FROM schools s
CROSS JOIN generate_series(1, 2)
WHERE s.state IS NOT NULL AND s.district IS NOT NULL
LIMIT 100;