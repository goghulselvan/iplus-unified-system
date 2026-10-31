-- Auto-confirm registration was written (auto_confirm_registration(), with audit
-- logging) but never actually attached as a trigger anywhere — this logic has never
-- executed. Wiring it up on school_project_workflow (not schools directly) so it:
--   1) correctly cascades to schools.registration_status via the existing
--      trg_sync_workflow_to_schools trigger, and
--   2) correctly wakes up trg_auto_exam_schedule (already live on this table),
--      which auto-assigns an exam schedule/slot once Confirmed + Received + Uploaded
--      all hold together — that trigger has been dormant for the same reason.
CREATE OR REPLACE FUNCTION public.auto_confirm_registration_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'Received' AND NEW.name_list_status = 'Uploaded'
     AND NEW.registration_status IS DISTINCT FROM 'Confirmed' THEN
    NEW.registration_status = 'Confirmed';
    NEW.updated_at = now();
    PERFORM public.log_security_action(
      'AUTO_REGISTRATION_CONFIRMED', 'school_project_workflow', NEW.id,
      jsonb_build_object('old_registration_status', OLD.registration_status),
      jsonb_build_object('new_registration_status', 'Confirmed',
        'payment_status', NEW.payment_status,
        'name_list_status', NEW.name_list_status,
        'trigger_reason', 'Payment received and name list uploaded'));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_auto_confirm_registration
  BEFORE INSERT OR UPDATE ON public.school_project_workflow
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_registration_workflow();

-- Backfill: apply the rule to schools that already meet both conditions right now
-- (currently just Avvai Vidhyashram Public School, SS 4231) via a real UPDATE so
-- both existing triggers (sync-to-schools, auto-exam-schedule) fire naturally.
UPDATE public.school_project_workflow w
SET registration_status = 'Confirmed'
WHERE w.project_id = 'dd5de83d-64f8-4113-a231-27024058396b'
  AND w.payment_status = 'Received'
  AND w.name_list_status = 'Uploaded'
  AND w.registration_status IS DISTINCT FROM 'Confirmed';
