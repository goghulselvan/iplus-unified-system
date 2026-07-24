-- Fix: update_school_namelist_status() only wrote schools.name_list_status.
-- school_project_workflow.name_list_status was never touched, so it sat stale,
-- and trg_sync_workflow_to_schools (fires on ANY school_project_workflow update)
-- would copy that stale value back onto schools, clobbering the correct 'Uploaded'.
-- Now this function keeps both copies in sync, same pattern as sync_payment_status().
CREATE OR REPLACE FUNCTION public.update_school_namelist_status(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  registration_count INTEGER;
  current_status name_list_status;
  v_project_id uuid;
  v_new_status name_list_status;
BEGIN
  SELECT name_list_status, current_project_id INTO current_status, v_project_id
  FROM public.schools
  WHERE id = p_school_id;

  SELECT
    (SELECT COUNT(*) FROM public.student_registrations WHERE school_id = p_school_id) +
    (SELECT COUNT(*) FROM public.portal_registered_students WHERE school_id = p_school_id)
  INTO registration_count;

  v_new_status := NULL;
  IF registration_count > 0 AND current_status IN ('Received', 'Pending') THEN
    v_new_status := 'Uploaded';
  ELSIF registration_count = 0 AND current_status = 'Uploaded' THEN
    v_new_status := 'Received';
  END IF;

  IF v_new_status IS NOT NULL THEN
    UPDATE public.schools
    SET name_list_status = v_new_status, updated_at = now()
    WHERE id = p_school_id;

    IF v_project_id IS NOT NULL THEN
      UPDATE public.school_project_workflow
      SET name_list_status = v_new_status, updated_at = now()
      WHERE school_id = p_school_id AND project_id = v_project_id;
    END IF;

    PERFORM public.log_security_action(
      'AUTO_NAMELIST_STATUS_UPDATE',
      'schools',
      p_school_id,
      jsonb_build_object('old_status', current_status),
      jsonb_build_object('new_status', v_new_status, 'registration_count', registration_count)
    );
  END IF;
END;
$function$;

-- Backfill: re-run the (now-fixed) function for every school so both copies of
-- name_list_status reconcile from the real portal_registered_students /
-- student_registrations counts, rather than trusting whichever stale value
-- happens to be sitting in schools right now.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.schools LOOP
    PERFORM public.update_school_namelist_status(r.id);
  END LOOP;
END $$;

-- Backfill: registration_status has no recompute function (it's a staff-driven
-- stage, not a count), so reconcile school_project_workflow from schools directly.
-- Root cause: BulkImportExport.tsx's CSV bulk-status-update writes directly to
-- schools.<field> for an arbitrary staff-picked workflow column, bypassing
-- school_project_workflow entirely (fixed in the same commit as this migration).
UPDATE public.school_project_workflow w
SET registration_status = s.registration_status,
    updated_at = now()
FROM public.schools s
WHERE w.school_id = s.id
  AND w.project_id = s.current_project_id
  AND w.registration_status IS DISTINCT FROM s.registration_status;
