-- Fix get_student_registrations_filtered to properly aggregate subjects
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
  subjects jsonb
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
    sr.registration_number_generated as registration_number,
    sr.created_at,
    s.school_name,
    s.ss_no as school_ss_no,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sub.id,
          'subject_name', sub.subject_name,
          'subject_code', sub.subject_code
        )
      ) FILTER (WHERE sub.id IS NOT NULL),
      '[]'::jsonb
    ) as subjects
  FROM student_registrations sr
  INNER JOIN schools s ON s.id = sr.school_id
  LEFT JOIN student_subjects ss ON ss.registration_id = sr.id
  LEFT JOIN olympiad_subjects sub ON sub.id = ss.subject_id
  WHERE sr.project_id = p_project_id
    AND (p_school_id IS NULL OR sr.school_id = p_school_id)
    AND (p_subject_id IS NULL OR ss.subject_id = p_subject_id OR p_subject_id IS NULL)
  GROUP BY sr.id, sr.project_id, sr.school_id, sr.student_name, sr.student_class, 
           sr.registration_number_generated, sr.created_at, s.school_name, s.ss_no
  ORDER BY sr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_registrations_filtered TO authenticated;