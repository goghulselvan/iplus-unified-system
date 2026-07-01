-- Update registration numbers for all students by regenerating them
UPDATE public.student_registrations 
SET registration_number_generated = generate_registration_number(
  school_id, 
  project_id, 
  student_class,
  (SELECT subject_id FROM public.student_subjects WHERE registration_id = student_registrations.id LIMIT 1)
)
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b'::uuid;