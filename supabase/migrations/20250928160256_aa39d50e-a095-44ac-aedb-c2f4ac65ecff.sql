-- Fix the constraint issue and continue building large test dataset
-- Add subjects only for registrations that don't have them yet
INSERT INTO public.student_subjects (registration_id, subject_id)
SELECT DISTINCT
  sr.id,
  (SELECT id FROM olympiad_subjects WHERE is_active = true LIMIT 1)
FROM student_registrations sr
LEFT JOIN student_subjects ss ON sr.id = ss.registration_id
WHERE sr.student_name LIKE 'Test Student %'
  AND ss.registration_id IS NULL;

-- Create 3rd batch - 1000 more registrations
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
  'Test Student ' || LPAD((generate_series + 600)::text, 4, '0'),
  ((generate_series + 600) % 8 + 1)::text,
  (SELECT user_id FROM profiles WHERE role = 'superadmin' LIMIT 1),
  (generate_series + 600) % 8 + 1
FROM schools s
CROSS JOIN generate_series(1, 20)
WHERE s.state IS NOT NULL AND s.district IS NOT NULL
LIMIT 1000;

-- Add subjects for the new registrations
INSERT INTO public.student_subjects (registration_id, subject_id)
SELECT 
  sr.id,
  (SELECT id FROM olympiad_subjects WHERE is_active = true LIMIT 1)
FROM student_registrations sr
LEFT JOIN student_subjects ss ON sr.id = ss.registration_id
WHERE sr.student_name LIKE 'Test Student %'
  AND ss.registration_id IS NULL;