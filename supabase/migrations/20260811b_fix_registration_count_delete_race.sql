-- Reported 2026-08-11: deleted a test student, dashboard "Registration Summary"
-- still showed 1 for Test School. Confirmed: portal_registered_students and
-- portal_student_enrollments were both empty for that school, but
-- portal_registration_counts still had a stale count=1 row.
--
-- Root cause: student deletion goes through `DELETE FROM
-- portal_registered_students` (4 call sites — portal's useDeleteStudent, and
-- two in the CRM's PortalRegistrationView.tsx), relying on ON DELETE CASCADE
-- to remove the enrollment rows. The cascade fires
-- portal_student_enrollments' AFTER DELETE trigger (sync_registration_counts)
-- for the cascaded rows, but by then the parent portal_registered_students
-- row is already gone — so the trigger's `SELECT school_id, project_id FROM
-- portal_registered_students WHERE id = OLD.student_id` finds nothing, and
-- the decrement is silently skipped. Same failure shape as the INSERT-side
-- bug fixed today, just on the other end.
--
-- Fix: denormalize school_id/project_id directly onto
-- portal_student_enrollments (stamped at insert time via a BEFORE INSERT
-- trigger, independent of the parent row's continued existence), so DELETE
-- can read OLD.school_id/OLD.project_id straight off the row being deleted —
-- no parent lookup needed at all, immune to cascade ordering regardless of
-- which of the 4 call sites triggers it.

ALTER TABLE public.portal_student_enrollments
  ADD COLUMN IF NOT EXISTS school_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid;

UPDATE public.portal_student_enrollments e
SET school_id = r.school_id, project_id = r.project_id
FROM public.portal_registered_students r
WHERE r.id = e.student_id AND e.school_id IS DISTINCT FROM r.school_id;

CREATE OR REPLACE FUNCTION public.stamp_enrollment_school_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  SELECT school_id, project_id INTO NEW.school_id, NEW.project_id
  FROM public.portal_registered_students WHERE id = NEW.student_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_enrollment_school_project ON public.portal_student_enrollments;
CREATE TRIGGER trg_stamp_enrollment_school_project
BEFORE INSERT ON public.portal_student_enrollments
FOR EACH ROW EXECUTE FUNCTION public.stamp_enrollment_school_project();

CREATE OR REPLACE FUNCTION public.sync_registration_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.school_id IS NOT NULL THEN
      INSERT INTO portal_registration_counts
             (project_id, school_id, olympiad_code, count, updated_at)
      VALUES (NEW.project_id, NEW.school_id, NEW.olympiad_code, 1, now())
      ON CONFLICT (project_id, school_id, olympiad_code)
      DO UPDATE SET
        count      = portal_registration_counts.count + 1,
        updated_at = now();
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.school_id IS NOT NULL THEN
      UPDATE portal_registration_counts SET
        count      = GREATEST(count - 1, 0),
        updated_at = now()
      WHERE project_id  = OLD.project_id
        AND school_id   = OLD.school_id
        AND olympiad_code = OLD.olympiad_code;

      DELETE FROM portal_registration_counts
      WHERE project_id  = OLD.project_id
        AND school_id   = OLD.school_id
        AND olympiad_code = OLD.olympiad_code
        AND count = 0;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- Keep the denormalized columns correct for enrollments created before their
-- student's school got linked (school_id was NULL at insert time, so the
-- BEFORE INSERT stamp above also stamped NULL) — same moment
-- reassign_pending_portal_students() already recomputes the count cache.
CREATE OR REPLACE FUNCTION public.reassign_pending_portal_students()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.school_id IS NOT NULL THEN
    UPDATE public.portal_registered_students
    SET school_id = NEW.school_id
    WHERE user_id = NEW.user_id AND school_id IS NULL;

    -- Keep schools.name_list_status / school_project_workflow in sync —
    -- the INSERT-time trigger couldn't do this since school_id was null then.
    PERFORM public.update_school_namelist_status(NEW.school_id);

    -- Stamp the denormalized school_id/project_id on these students'
    -- enrollments too, so a later delete can decrement the cache without
    -- depending on the parent row still existing at that point.
    UPDATE public.portal_student_enrollments e
    SET school_id = r.school_id, project_id = r.project_id
    FROM public.portal_registered_students r
    WHERE r.id = e.student_id AND r.school_id = NEW.school_id AND e.school_id IS NULL;

    -- Recompute the registration-count cache for this school directly from
    -- source data — sync_registration_counts() couldn't count these
    -- enrollments at insert time since school_id was null then either.
    INSERT INTO public.portal_registration_counts (project_id, school_id, olympiad_code, count, updated_at)
    SELECT r.project_id, r.school_id, e.olympiad_code, COUNT(*), now()
    FROM public.portal_student_enrollments e
    JOIN public.portal_registered_students r ON r.id = e.student_id
    WHERE r.school_id = NEW.school_id
    GROUP BY r.project_id, r.school_id, e.olympiad_code
    ON CONFLICT (project_id, school_id, olympiad_code)
    DO UPDATE SET count = EXCLUDED.count, updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

-- One-time repair: purge the current drift (including Test School's stale
-- count=1 with nothing underneath it) by recomputing the whole cache table
-- from live data.
TRUNCATE public.portal_registration_counts;

INSERT INTO public.portal_registration_counts (project_id, school_id, olympiad_code, count, updated_at)
SELECT r.project_id, r.school_id, e.olympiad_code, COUNT(*), now()
FROM public.portal_student_enrollments e
JOIN public.portal_registered_students r ON r.id = e.student_id
WHERE r.school_id IS NOT NULL
GROUP BY r.project_id, r.school_id, e.olympiad_code;
