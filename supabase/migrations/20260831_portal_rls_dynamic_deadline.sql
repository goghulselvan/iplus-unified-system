-- ============================================================================
-- Portal RLS: dynamic registration deadline  — 2026-08-31  (PRODUCTION OUTAGE FIX)
--
-- The 6 own-row policies on portal_registered_students / portal_student_enrollments
-- each hard-coded `now() < '2026-08-30 18:29:59+00'`. The deadline moved 30 -> 31
-- Aug but these policies were missed (same bug class already recorded twice:
-- 2026-08-07 fixed a stale Aug-20 literal here; feedback_registration_deadline_
-- multiple_locations lists the known copies but NOT these policies). Result: from
-- 2026-08-31 00:00 IST every school's add/edit/delete of students was RLS-denied
-- ("new row violates row-level security policy for table portal_registered_students").
--
-- Fix: replace the literal with portal_registration_open(project_id), which reads
-- olympiad_projects.registration_deadline live. Future deadline changes need zero
-- policy edits.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_registration_open(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT now() < COALESCE(
    (SELECT op.registration_deadline FROM olympiad_projects op WHERE op.id = p_project_id),
    'infinity'::timestamptz
  );
$function$;

GRANT EXECUTE ON FUNCTION public.portal_registration_open(uuid) TO authenticated, anon, service_role;

-- ---- portal_registered_students -------------------------------------------------
ALTER POLICY portal_own_students_insert ON public.portal_registered_students
  WITH CHECK (
    (user_id = auth.uid())
    AND ((school_id IS NULL) OR (school_id = get_portal_school_id()))
    AND portal_registration_open(project_id)
  );

ALTER POLICY portal_own_students_update ON public.portal_registered_students
  USING (
    ((school_id = get_portal_school_id()) OR ((school_id IS NULL) AND (user_id = auth.uid())))
    AND portal_registration_open(project_id)
  );

ALTER POLICY portal_own_students_delete ON public.portal_registered_students
  USING (
    ((school_id = get_portal_school_id()) OR ((school_id IS NULL) AND (user_id = auth.uid())))
    AND portal_registration_open(project_id)
  );

-- ---- portal_student_enrollments (project_id stamped by BEFORE trigger before RLS) --
ALTER POLICY portal_own_enrollments_insert ON public.portal_student_enrollments
  WITH CHECK (
    (student_id IN (
      SELECT r.id FROM portal_registered_students r
      WHERE (r.school_id = get_portal_school_id())
         OR ((r.school_id IS NULL) AND (r.user_id = auth.uid()))
    ))
    AND portal_registration_open(project_id)
  );

ALTER POLICY portal_own_enrollments_update ON public.portal_student_enrollments
  USING (
    (student_id IN (
      SELECT r.id FROM portal_registered_students r
      WHERE (r.school_id = get_portal_school_id())
         OR ((r.school_id IS NULL) AND (r.user_id = auth.uid()))
    ))
    AND portal_registration_open(project_id)
  );

ALTER POLICY portal_own_enrollments_delete ON public.portal_student_enrollments
  USING (
    (student_id IN (
      SELECT r.id FROM portal_registered_students r
      WHERE (r.school_id = get_portal_school_id())
         OR ((r.school_id IS NULL) AND (r.user_id = auth.uid()))
    ))
    AND portal_registration_open(project_id)
  );

COMMIT;
