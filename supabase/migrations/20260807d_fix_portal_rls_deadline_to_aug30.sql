-- The app-level registration deadline was moved from 20 Aug -> 30 Aug 2026
-- (see iplus-olympiad-spark commit "Update registration deadline from 20
-- Aug to 30 Aug 2026"), but these RLS policies still had the old 20 Aug
-- cutoff hard-coded, so schools would have been silently locked out of
-- adding/editing/removing students 9 days before the UI said registration
-- closed. Re-point every policy to the same Aug 30 cutoff the frontend uses.

DROP POLICY IF EXISTS "portal_own_students_insert" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_insert" ON public.portal_registered_students
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (school_id IS NULL OR school_id = get_portal_school_id())
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
  );

DROP POLICY IF EXISTS "portal_own_students_update" ON public.portal_registered_students;
CREATE POLICY "portal_own_students_update" ON public.portal_registered_students
  FOR UPDATE
  USING (
    (school_id = get_portal_school_id() OR (school_id IS NULL AND user_id = auth.uid()))
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
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
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
  );

DROP POLICY IF EXISTS "portal_own_enrollments_insert" ON public.portal_student_enrollments;
CREATE POLICY "portal_own_enrollments_insert" ON public.portal_student_enrollments
  FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.portal_registered_students
      WHERE school_id = get_portal_school_id()
         OR (school_id IS NULL AND user_id = auth.uid())
    )
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
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
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
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
    AND (now() < '2026-08-30 18:29:59+00'::timestamptz)
  );
