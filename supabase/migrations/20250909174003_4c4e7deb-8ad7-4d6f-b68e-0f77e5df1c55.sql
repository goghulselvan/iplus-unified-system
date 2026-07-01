-- Delete all student registrations and their associated subjects for the specific school
-- First delete student_subjects records
DELETE FROM student_subjects 
WHERE registration_id IN (
  SELECT id FROM student_registrations 
  WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
  AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
);

-- Then delete student_registrations records
DELETE FROM student_registrations 
WHERE school_id = '9559412d-4d67-4332-8827-7a2e7545562b' 
AND project_id = 'da46555a-76f0-4767-890e-647896d5ff90';