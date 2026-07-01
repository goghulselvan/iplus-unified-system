-- Remove the old student sequence function (no longer needed with alphabetical system)
DROP FUNCTION IF EXISTS public.get_next_student_sequence(uuid, uuid, integer);

-- Remove the old assign_school_code function that used sequential assignment
DROP FUNCTION IF EXISTS public.assign_school_code(uuid, text, text);

-- Verify student-subject relationships are preserved
SELECT 
  'Student-Subject Data Check' as check_type,
  COUNT(*) as total_subject_assignments,
  COUNT(DISTINCT sr.id) as unique_students,
  COUNT(DISTINCT ss.subject_id) as subjects_covered
FROM student_registrations sr
INNER JOIN student_subjects ss ON sr.id = ss.registration_id;