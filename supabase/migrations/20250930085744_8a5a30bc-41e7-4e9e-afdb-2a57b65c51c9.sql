-- Test function to generate a registration number for a specific student and subject
CREATE OR REPLACE FUNCTION public.test_registration_number_generation(
  p_school_id uuid,
  p_project_id uuid,
  p_student_class text,
  p_subject_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN public.generate_registration_number(p_school_id, p_project_id, p_student_class, p_subject_id);
END;
$$;