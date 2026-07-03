-- OlympiadManagement server-side RPCs
-- Replaces client-side full-table fetch at 5M rows with:
--   get_olympiad_stats            — fast aggregate (no row scan, uses indexes)
--   get_olympiad_participations   — paginated list with server-side filters

-- ============================================================
-- 1. Aggregate stats — runs independently of the list
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_olympiad_stats(p_project_id uuid)
RETURNS TABLE(
  total_participations bigint,
  total_students       bigint,
  total_schools        bigint,
  subject_stats        jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  WITH enroll_agg AS (
    SELECT
      e.olympiad_code,
      COUNT(e.id)                     AS participations,
      COUNT(DISTINCT r.id)            AS students,
      COUNT(DISTINCT r.school_id)     AS schools
    FROM portal_student_enrollments e
    JOIN portal_registered_students r ON r.id = e.student_id
    WHERE r.project_id = p_project_id
    GROUP BY e.olympiad_code
  ),
  totals AS (
    SELECT
      COALESCE(SUM(participations), 0) AS total_participations,
      -- total unique students across all subjects
      (SELECT COUNT(DISTINCT id) FROM portal_registered_students WHERE project_id = p_project_id) AS total_students,
      (SELECT COUNT(DISTINCT school_id) FROM portal_registered_students WHERE project_id = p_project_id) AS total_schools
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
$$;

GRANT EXECUTE ON FUNCTION public.get_olympiad_stats(uuid) TO authenticated;

-- ============================================================
-- 2. Paginated participations list with server-side filters
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_olympiad_participations(
  p_project_id   uuid,
  p_search       text    DEFAULT NULL,
  p_olympiad_code text   DEFAULT NULL,
  p_class_code   text    DEFAULT NULL,
  p_school_id    uuid    DEFAULT NULL,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0
)
RETURNS TABLE(
  enrollment_id  uuid,
  olympiad_code  text,
  student_id     uuid,
  student_name   text,
  class_code     text,
  school_id      uuid,
  school_name    text,
  ss_no          integer,
  total_count    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
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
    WHERE r.project_id = p_project_id
      AND (p_olympiad_code IS NULL OR e.olympiad_code = p_olympiad_code)
      AND (p_class_code    IS NULL OR r.class_code    = p_class_code)
      AND (p_school_id     IS NULL OR r.school_id     = p_school_id)
      AND (p_search IS NULL OR
           r.student_name ILIKE '%' || p_search || '%' OR
           s.school_name  ILIKE '%' || p_search || '%')
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
$$;

GRANT EXECUTE ON FUNCTION public.get_olympiad_participations(uuid, text, text, text, uuid, integer, integer) TO authenticated;

-- ============================================================
-- 3. Per-subject class breakdown for the stats panel
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_olympiad_subject_class_stats(
  p_project_id   uuid,
  p_olympiad_code text DEFAULT NULL
)
RETURNS TABLE(
  olympiad_code  text,
  class_code     text,
  count          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT
    e.olympiad_code,
    r.class_code,
    COUNT(*)::bigint AS count
  FROM portal_student_enrollments e
  JOIN portal_registered_students r ON r.id = e.student_id
  WHERE r.project_id = p_project_id
    AND (p_olympiad_code IS NULL OR e.olympiad_code = p_olympiad_code)
  GROUP BY e.olympiad_code, r.class_code
  ORDER BY e.olympiad_code, r.class_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_olympiad_subject_class_stats(uuid, text) TO authenticated;
