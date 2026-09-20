-- consent_form_requested was two (really three) independently-editable pieces
-- of state that nothing kept in sync: schools.consent_form_requested (set by
-- WorkflowEditor's Yes/No click), school_project_workflow.consent_form_requested
-- (the per-project copy the Dashboard actually reads), and
-- consent_forms.forms_requested (the real count, entered separately in the
-- Consent Form tab). Entering a count never touched either flag — confirmed by
-- reading ConsentFormManager.tsx, it only writes consent_forms + activity_logs.
--
-- Combined with useWorkflow.ts's updateWorkflowStatus bare-writing schools
-- alone (fixed separately, same session), the flag and the real count had no
-- relationship to each other at all. Live proof: 31 schools carry a real,
-- substantial count in consent_forms (40 to 1,055 forms) while the workflow
-- flag reads 'No' for every one of them.
--
-- Fix: a real count is now authoritative. Entering forms_requested > 0 sets
-- the workflow flag to 'Yes' automatically; the existing, already-verified
-- trg_sync_workflow_to_schools trigger mirrors it down to schools with no new
-- plumbing needed there. One direction only — clearing a count back to 0 does
-- NOT auto-revert the flag to 'No', since 0 is ambiguous with "not entered
-- yet," not "no longer wanted." The manual Yes click in WorkflowEditor still
-- works on its own for "requested, count not known yet" — this only adds a
-- second way to reach 'Yes', it doesn't remove the first.

CREATE OR REPLACE FUNCTION public.auto_set_consent_requested_from_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.school_project_workflow
  SET consent_form_requested = 'Yes'
  WHERE school_id = NEW.school_id
    AND project_id = NEW.project_id
    AND consent_form_requested IS DISTINCT FROM 'Yes';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_consent_from_count ON public.consent_forms;
CREATE TRIGGER trg_auto_consent_from_count
  AFTER INSERT OR UPDATE OF forms_requested ON public.consent_forms
  FOR EACH ROW
  WHEN (NEW.forms_requested > 0)
  EXECUTE FUNCTION public.auto_set_consent_requested_from_count();

-- Backfill: apply the same rule retroactively. Every school with a real count
-- already on record gets its workflow flag corrected now, same as the trigger
-- will do going forward. Only touches school_project_workflow — the existing
-- sync trigger mirrors each row down to schools as part of the same UPDATE.
UPDATE public.school_project_workflow w
SET consent_form_requested = 'Yes'
FROM public.consent_forms cf
WHERE cf.school_id = w.school_id
  AND cf.project_id = w.project_id
  AND cf.forms_requested > 0
  AND w.consent_form_requested IS DISTINCT FROM 'Yes';

-- Backfill: the 10 schools found live-drifted on consent_form_requested this
-- session where schools already correctly read 'Yes' (a real WorkflowEditor
-- click) but workflow was never updated (the root bug just fixed above) and
-- had no consent_forms row to catch it via the count-based backfill.
UPDATE public.school_project_workflow w
SET consent_form_requested = 'Yes'
FROM public.schools s
WHERE s.id = w.school_id
  AND w.project_id = 'dd5de83d-64f8-4113-a231-27024058396b'
  AND s.consent_form_requested = 'Yes'
  AND w.consent_form_requested IS DISTINCT FROM 'Yes';

-- Backfill: the 2 registration_status + 1 name_list_status drift found this
-- session, same root cause (bare schools.update() via useWorkflow.ts, wiped by
-- switch_active_project's mirror). schools held the more advanced, correct
-- value in both cases; workflow was the stale one.
UPDATE public.school_project_workflow w
SET registration_status = s.registration_status
FROM public.schools s
WHERE s.id = w.school_id
  AND w.project_id = 'dd5de83d-64f8-4113-a231-27024058396b'
  AND s.registration_status IS DISTINCT FROM w.registration_status;

UPDATE public.school_project_workflow w
SET name_list_status = s.name_list_status
FROM public.schools s
WHERE s.id = w.school_id
  AND w.project_id = 'dd5de83d-64f8-4113-a231-27024058396b'
  AND s.name_list_status IS DISTINCT FROM w.name_list_status;
