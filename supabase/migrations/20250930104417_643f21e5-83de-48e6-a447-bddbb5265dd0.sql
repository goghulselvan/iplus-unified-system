-- Fix security warning: Set search_path for validate_kidspo_class_restriction function

CREATE OR REPLACE FUNCTION validate_kidspo_class_restriction()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;