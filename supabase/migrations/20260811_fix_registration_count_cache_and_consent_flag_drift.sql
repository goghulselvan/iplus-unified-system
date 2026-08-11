-- Two independent bugs reported 2026-08-11:
--
-- 1) Dashboard "Total Registrations" (live join, 473) vs "Registration Summary"
--    (cached portal_registration_counts, 442) drifted by exactly 31 rows.
--    Root cause: sync_registration_counts() only increments the cache on
--    portal_student_enrollments INSERT, looking up school_id from
--    portal_registered_students AT THAT INSTANT. Students added to the portal
--    before their school was linked to a CRM record have school_id = NULL at
--    insert time, so the trigger's `IF v_school_id IS NOT NULL` guard skips
--    the increment entirely. reassign_pending_portal_students() later backfills
--    school_id once the school is linked, but never recomputes the cache —
--    those enrollments are silently lost from Registration Summary forever.
--
-- 2) consent_form_requested silently reverting to 'No' after being set to
--    'Yes' and consent forms actually being entered (e.g. Southside Matric
--    SS 143, and 26 other schools with real forms_requested counts sitting
--    behind a 'No' flag). A 2026-07-25 migration documented this exact bug
--    for one school (Angels Babyland, SS 7759) and claimed to fix it, but
--    only consolidated the consent_forms data — never restored the flag.
--    One-time data backfill here; the recurring write-path bug itself needs
--    separate frontend investigation.

-- === Fix 1a: recompute the registration-count cache from live data ===
TRUNCATE public.portal_registration_counts;

INSERT INTO public.portal_registration_counts (project_id, school_id, olympiad_code, count, updated_at)
SELECT r.project_id, r.school_id, e.olympiad_code, COUNT(*), now()
FROM public.portal_student_enrollments e
JOIN public.portal_registered_students r ON r.id = e.student_id
WHERE r.school_id IS NOT NULL
GROUP BY r.project_id, r.school_id, e.olympiad_code;

-- === Fix 1b: stop it from recurring — recompute the cache for a school's
-- enrollments whenever that school gets linked (backfilled from NULL) ===
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

-- === Fix 2: backfill consent_form_requested back to 'Yes' for every school
-- that has a real entered consent-form count but the flag reverted to 'No' ===
UPDATE public.schools s
SET consent_form_requested = 'Yes', updated_at = now()
FROM public.consent_forms cf
WHERE cf.school_id = s.id
  AND cf.forms_requested > 0
  AND s.consent_form_requested <> 'Yes';

UPDATE public.school_project_workflow w
SET consent_form_requested = 'Yes', updated_at = now()
FROM public.consent_forms cf
WHERE cf.school_id = w.school_id
  AND cf.project_id = w.project_id
  AND cf.forms_requested > 0
  AND w.consent_form_requested <> 'Yes';
