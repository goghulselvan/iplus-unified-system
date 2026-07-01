-- Generate registration number for existing student
UPDATE student_registrations 
SET registration_number_generated = generate_registration_number(
  school_id, 
  project_id, 
  student_class
)
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
AND registration_number_generated IS NULL;