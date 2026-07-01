-- Fix get_student_registrations_filtered to return correct registration number column
DROP FUNCTION IF EXISTS get_student_registrations_filtered(uuid, uuid, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION get_student_registrations_filtered(
  p_project_id uuid,
  p_school_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_student_class text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  school_id uuid,
  student_name text,
  student_class text,
  registration_number text,
  created_at timestamptz,
  school_name text,
  school_ss_no integer,
  subject_id uuid,
  subject_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sr.id,
    sr.project_id,
    sr.school_id,
    sr.student_name,
    sr.student_class,
    sr.registration_number_generated as registration_number,  -- Use the correct column
    sr.created_at,
    s.school_name,
    s.ss_no as school_ss_no,
    ss.subject_id,
    sub.subject_name
  FROM student_registrations sr
  INNER JOIN schools s ON s.id = sr.school_id
  INNER JOIN student_subjects ss ON ss.registration_id = sr.id
  INNER JOIN olympiad_subjects sub ON sub.id = ss.subject_id
  WHERE sr.project_id = p_project_id
    AND (p_school_id IS NULL OR sr.school_id = p_school_id)
    AND (p_subject_id IS NULL OR ss.subject_id = p_subject_id)
    AND (p_student_class IS NULL OR sr.student_class = p_student_class)
  ORDER BY sr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_registrations_filtered TO authenticated;