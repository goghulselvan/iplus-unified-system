-- Add foreign key constraint between student_subjects and olympiad_subjects
ALTER TABLE student_subjects 
ADD CONSTRAINT fk_student_subjects_olympiad_subjects 
FOREIGN KEY (subject_id) 
REFERENCES olympiad_subjects(id);