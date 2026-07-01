-- Add validation for KidsPO subject - only LKG and UKG allowed
-- This function validates that KidsPO (subject_code = '5') is only for LKG (14) and UKG (15)

CREATE OR REPLACE FUNCTION validate_kidspo_class_restriction()
RETURNS TRIGGER AS $$
DECLARE
  v_subject_code text;
  v_student_class text;
  v_class_code integer;
BEGIN
  -- Get the subject code for this registration
  SELECT subject_code INTO v_subject_code
  FROM olympiad_subjects
  WHERE id = NEW.subject_id;
  
  -- Get the student's class and class code
  SELECT student_class, class_code INTO v_student_class, v_class_code
  FROM student_registrations
  WHERE id = NEW.registration_id;
  
  -- Validate KidsPO restriction
  IF v_subject_code = '5' THEN
    -- KidsPO can only be for LKG (14) or UKG (15)
    IF v_class_code NOT IN (14, 15) THEN
      RAISE EXCEPTION 'KidsPO (Subject 5) is only available for LKG and UKG students. Current class: %, class code: %', 
        v_student_class, v_class_code;
    END IF;
  ELSE
    -- Non-KidsPO subjects cannot be for LKG or UKG
    IF v_class_code IN (14, 15) THEN
      RAISE EXCEPTION 'LKG and UKG students can only register for KidsPO (Subject 5). Current subject: %', 
        v_subject_code;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate KidsPO restrictions on insert and update
DROP TRIGGER IF EXISTS validate_kidspo_restriction_trigger ON student_subjects;
CREATE TRIGGER validate_kidspo_restriction_trigger
BEFORE INSERT OR UPDATE ON student_subjects
FOR EACH ROW
EXECUTE FUNCTION validate_kidspo_class_restriction();