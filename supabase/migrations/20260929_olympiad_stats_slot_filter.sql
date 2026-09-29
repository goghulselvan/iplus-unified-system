-- Slot-wise counting on the Olympiad Management page.
--
-- Slot membership lives on exam_slots (one row per school+project ->
-- slot_template_id), not on the enrollment/student rows themselves, so
-- every one of the three RPCs behind this page needs the same new filter:
-- p_slot_template_id (a specific slot) or p_unassigned_only (schools with
-- no exam_slots row / no slot_template_id yet). Both default to "no filter"
-- so every existing call site (nothing passes these yet) behaves exactly
-- as before — the "All" view is untouched.
--
-- CREATE OR REPLACE cannot add parameters to an existing function — needs
-- an explicit DROP of the exact old signature first, or Postgres raises
-- "function ... is not unique" once both would coexist.

DROP FUNCTION IF EXISTS public.get_olympiad_stats(uuid);
DROP FUNCTION IF EXISTS public.get_olympiad_subject_class_stats(uuid, text);
DROP FUNCTION IF EXISTS public.get_olympiad_participations(uuid, text, text, text, uuid, integer, integer);

CREATE FUNCTION public.get_olympiad_stats(
  p_project_id uuid,
  p_slot_template_id uuid DEFAULT NULL,
  p_unassigned_only boolean DEFAULT false
)
 RETURNS TABLE(total_participations bigint, total_students bigint, total_schools bigint, subject_stats jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scoped_students AS (
    SELECT r.id, r.school_id
    FROM portal_registered_students r
    LEFT JOIN exam_slots xs ON xs.school_id = r.school_id AND xs.project_id = p_project_id
    WHERE r.project_id = p_project_id
      AND (
        (p_slot_template_id IS NULL AND NOT p_unassigned_only)
        OR (p_slot_template_id IS NOT NULL AND xs.slot_template_id = p_slot_template_id)
        OR (p_unassigned_only AND xs.slot_template_id IS NULL)
      )
  ),
  enroll_agg AS (
    SELECT
      e.olympiad_code,
      COUNT(e.id)                 AS participations,
      COUNT(DISTINCT s.id)        AS students,
      COUNT(DISTINCT s.school_id) AS schools
    FROM portal_student_enrollments e
    JOIN scoped_students s ON s.id = e.student_id
    GROUP BY e.olympiad_code
  ),
  totals AS (
    SELECT
      COALESCE(SUM(participations), 0)                      AS total_participations,
      (SELECT COUNT(DISTINCT id) FROM scoped_students)       AS total_students,
      (SELECT COUNT(DISTINCT school_id) FROM scoped_students) AS total_schools
    FROM enroll_agg
  )
  SELECT
    t.total_participations,
    t.total_students,
    t.total_schools,
    COALESCE(
      jsonb_object_agg(a.olympiad_code, jsonb_build_object(
        'participations', a.participations,
        'students',       a.students,
        'schools',        a.schools
      )),
      '{}'::jsonb
    ) AS subject_stats
  FROM totals t
  LEFT JOIN enroll_agg a ON true
  GROUP BY t.total_participations, t.total_students, t.total_schools;
$function$;

CREATE FUNCTION public.get_olympiad_subject_class_stats(
  p_project_id uuid,
  p_olympiad_code text DEFAULT NULL,
  p_slot_template_id uuid DEFAULT NULL,
  p_unassigned_only boolean DEFAULT false
)
 RETURNS TABLE(olympiad_code text, class_code text, count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scoped_students AS (
    SELECT r.id, r.class_code
    FROM portal_registered_students r
    LEFT JOIN exam_slots xs ON xs.school_id = r.school_id AND xs.project_id = p_project_id
    WHERE r.project_id = p_project_id
      AND (
        (p_slot_template_id IS NULL AND NOT p_unassigned_only)
        OR (p_slot_template_id IS NOT NULL AND xs.slot_template_id = p_slot_template_id)
        OR (p_unassigned_only AND xs.slot_template_id IS NULL)
      )
  )
  SELECT
    e.olympiad_code,
    s.class_code,
    COUNT(*)::bigint AS count
  FROM portal_student_enrollments e
  JOIN scoped_students s ON s.id = e.student_id
  WHERE (p_olympiad_code IS NULL OR e.olympiad_code = p_olympiad_code)
  GROUP BY e.olympiad_code, s.class_code
  ORDER BY e.olympiad_code, s.class_code;
$function$;

CREATE FUNCTION public.get_olympiad_participations(
  p_project_id uuid,
  p_search text DEFAULT NULL,
  p_olympiad_code text DEFAULT NULL,
  p_class_code text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_slot_template_id uuid DEFAULT NULL,
  p_unassigned_only boolean DEFAULT false
)
 RETURNS TABLE(enrollment_id uuid, olympiad_code text, student_id uuid, student_name text, class_code text, school_id uuid, school_name text, ss_no integer, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      e.id          AS enrollment_id,
      e.olympiad_code,
      r.id          AS student_id,
      r.student_name,
      r.class_code,
      r.school_id,
      s.school_name,
      s.ss_no
    FROM portal_student_enrollments e
    JOIN portal_registered_students r ON r.id = e.student_id
    JOIN schools s ON s.id = r.school_id
    LEFT JOIN exam_slots xs ON xs.school_id = r.school_id AND xs.project_id = p_project_id
    WHERE r.project_id = p_project_id
      AND (p_olympiad_code IS NULL OR e.olympiad_code = p_olympiad_code)
      AND (p_class_code    IS NULL OR r.class_code    = p_class_code)
      AND (p_school_id     IS NULL OR r.school_id     = p_school_id)
      AND (p_search IS NULL OR
           r.student_name ILIKE '%' || p_search || '%' OR
           s.school_name  ILIKE '%' || p_search || '%')
      AND (
        (p_slot_template_id IS NULL AND NOT p_unassigned_only)
        OR (p_slot_template_id IS NOT NULL AND xs.slot_template_id = p_slot_template_id)
        OR (p_unassigned_only AND xs.slot_template_id IS NULL)
      )
  )
  SELECT
    b.enrollment_id, b.olympiad_code,
    b.student_id, b.student_name, b.class_code,
    b.school_id, b.school_name, b.ss_no,
    COUNT(*) OVER()::bigint AS total_count
  FROM base b
  ORDER BY b.ss_no ASC, b.student_name ASC, b.olympiad_code ASC
  LIMIT p_limit
  OFFSET p_offset;
$function$;
