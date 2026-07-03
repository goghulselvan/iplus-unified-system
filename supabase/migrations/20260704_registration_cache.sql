-- Registration summary cache: pre-aggregated enrollment counts per (project, school, olympiad)
-- Eliminates O(5M rows) GROUP BY in get_portal_registration_summary at query time.
-- Maintained incrementally by trigger on portal_student_enrollments.

-- ============================================================
-- 1. Cache table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portal_registration_counts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL,
  school_id     uuid        NOT NULL,
  olympiad_code text        NOT NULL,
  count         bigint      NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_prc_project_school_olympiad UNIQUE (project_id, school_id, olympiad_code)
);

CREATE INDEX IF NOT EXISTS idx_prc_project
  ON public.portal_registration_counts(project_id);

CREATE INDEX IF NOT EXISTS idx_prc_project_school
  ON public.portal_registration_counts(project_id, school_id);

-- ============================================================
-- 2. Trigger: maintain counts on every INSERT/DELETE of an enrollment
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_registration_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id  uuid;
  v_project_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT school_id, project_id
    INTO   v_school_id, v_project_id
    FROM   portal_registered_students
    WHERE  id = NEW.student_id;

    IF v_school_id IS NOT NULL THEN
      INSERT INTO portal_registration_counts
             (project_id, school_id, olympiad_code, count, updated_at)
      VALUES (v_project_id, v_school_id, NEW.olympiad_code, 1, now())
      ON CONFLICT (project_id, school_id, olympiad_code)
      DO UPDATE SET
        count      = portal_registration_counts.count + 1,
        updated_at = now();
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT school_id, project_id
    INTO   v_school_id, v_project_id
    FROM   portal_registered_students
    WHERE  id = OLD.student_id;

    IF v_school_id IS NOT NULL THEN
      UPDATE portal_registration_counts SET
        count      = GREATEST(count - 1, 0),
        updated_at = now()
      WHERE project_id  = v_project_id
        AND school_id   = v_school_id
        AND olympiad_code = OLD.olympiad_code;

      -- Remove zero rows to keep cache clean
      DELETE FROM portal_registration_counts
      WHERE project_id  = v_project_id
        AND school_id   = v_school_id
        AND olympiad_code = OLD.olympiad_code
        AND count = 0;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_registration_counts ON public.portal_student_enrollments;
CREATE TRIGGER trg_sync_registration_counts
  AFTER INSERT OR DELETE ON public.portal_student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sync_registration_counts();

-- ============================================================
-- 3. Backfill from existing data
-- ============================================================
INSERT INTO public.portal_registration_counts (project_id, school_id, olympiad_code, count)
SELECT
  r.project_id,
  r.school_id,
  e.olympiad_code,
  COUNT(e.id)::bigint
FROM portal_student_enrollments e
JOIN portal_registered_students r ON r.id = e.student_id
GROUP BY r.project_id, r.school_id, e.olympiad_code
ON CONFLICT (project_id, school_id, olympiad_code)
DO UPDATE SET count = EXCLUDED.count, updated_at = now();

-- ============================================================
-- 4. Rewrite get_portal_registration_summary to read from cache
--    O(cache_rows) instead of O(5M enrollment rows)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_portal_registration_summary(p_project_id uuid)
RETURNS TABLE(
  school_id     uuid,
  ss_no         integer,
  school_name   text,
  subject_counts jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT
    c.school_id,
    s.ss_no::integer,
    s.school_name,
    jsonb_object_agg(
      c.olympiad_code,
      c.count
      ORDER BY COALESCE(os.subject_code::int, 99)
    ) AS subject_counts
  FROM portal_registration_counts c
  JOIN schools s ON s.id = c.school_id
  LEFT JOIN olympiad_subjects os
    ON  os.alphabetical_code = c.olympiad_code
    AND os.project_id = p_project_id
  WHERE c.project_id = p_project_id
    AND c.count > 0
  GROUP BY c.school_id, s.ss_no, s.school_name
  ORDER BY s.ss_no;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_registration_summary(uuid) TO authenticated;
