-- Allow schools to add students on the portal before their account is
-- linked to a CRM school record. Students are stored against the portal
-- user_id when school_id is unknown, then automatically reassigned to the
-- real school_id the moment CRM staff link the account (school_portal_accounts
-- .school_id goes from null -> a value via RegistrationApproval.tsx).
--
-- Root cause this fixes: portal_registered_students.school_id was NOT NULL,
-- so useAddStudent() sent an empty-string school_id for unlinked accounts,
-- and Postgres rejected it with "invalid input syntax for type uuid".

ALTER TABLE public.portal_registered_students
  ALTER COLUMN school_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

ALTER TABLE public.portal_registered_students
  ADD CONSTRAINT portal_registered_students_school_or_user_chk
  CHECK (school_id IS NOT NULL OR user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS portal_reg_students_pending_user_idx
  ON public.portal_registered_students (user_id)
  WHERE school_id IS NULL;

-- Reassign a user's pending (school_id IS NULL) students the moment their
-- portal account gets linked to a real school. SECURITY DEFINER because the
-- portal user themself has no RLS grant to touch other rows / the schools
-- namelist status function.
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
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reassign_pending_portal_students ON public.school_portal_accounts;
CREATE TRIGGER trg_reassign_pending_portal_students
  AFTER INSERT OR UPDATE OF school_id ON public.school_portal_accounts
  FOR EACH ROW
  WHEN (NEW.school_id IS NOT NULL)
  EXECUTE FUNCTION public.reassign_pending_portal_students();

-- ── RLS: portal_registered_students ─────────────────────────────────────
-- Extend the existing "own school" policies to also cover rows the caller
-- owns by user_id while school_id is still null (pre-link).

DROP POLICY IF EXISTS "portal_own_students_insert" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_insert" ON public.portal_registered_students
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (school_id IS NULL OR school_id = get_portal_school_id())
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  );

DROP POLICY IF EXISTS "portal_own_students_select" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_select" ON public.portal_registered_students
  FOR SELECT
  USING (
    school_id = get_portal_school_id()
    OR (school_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portal_own_students_update" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_update" ON public.portal_registered_students
  FOR UPDATE
  USING (
    (school_id = get_portal_school_id() OR (school_id IS NULL AND user_id = auth.uid()))
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  )
  WITH CHECK (
    school_id = get_portal_school_id()
    OR (school_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portal_own_students_delete" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_delete" ON public.portal_registered_students
  FOR DELETE
  USING (
    (school_id = get_portal_school_id() OR (school_id IS NULL AND user_id = auth.uid()))
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  );

-- ── RLS: portal_student_enrollments ──────────────────────────────────────
-- Same "own by school OR own by pending user_id" reach, via the parent row.

DROP POLICY IF EXISTS "portal_own_enrollments_insert" ON public.portal_student_enrollments;
CREATE POLICY "portal_own_enrollments_insert" ON public.portal_student_enrollments
  FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.portal_registered_students
      WHERE school_id = get_portal_school_id()
         OR (school_id IS NULL AND user_id = auth.uid())
    )
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  );

DROP POLICY IF EXISTS "portal_own_enrollments_select" ON public.portal_student_enrollments;
CREATE POLICY "portal_own_enrollments_select" ON public.portal_student_enrollments
  FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.portal_registered_students
      WHERE school_id = get_portal_school_id()
         OR (school_id IS NULL AND user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "portal_own_enrollments_update" ON public.portal_student_enrollments;
CREATE POLICY "portal_own_enrollments_update" ON public.portal_student_enrollments
  FOR UPDATE
  USING (
    student_id IN (
      SELECT id FROM public.portal_registered_students
      WHERE school_id = get_portal_school_id()
         OR (school_id IS NULL AND user_id = auth.uid())
    )
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  );

DROP POLICY IF EXISTS "portal_own_enrollments_delete" ON public.portal_student_enrollments;
CREATE POLICY "portal_own_enrollments_delete" ON public.portal_student_enrollments
  FOR DELETE
  USING (
    student_id IN (
      SELECT id FROM public.portal_registered_students
      WHERE school_id = get_portal_school_id()
         OR (school_id IS NULL AND user_id = auth.uid())
    )
    AND (now() < '2026-08-20 18:29:59+00'::timestamptz)
  );
