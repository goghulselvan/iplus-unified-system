-- Patch the 4 existing schools triggers/functions that fire on UPDATE
-- to short-circuit when our mirror mode is active.

CREATE OR REPLACE FUNCTION public.auto_recalculate_on_participants_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.total_participants IS DISTINCT FROM NEW.total_participants THEN
    PERFORM public.recalculate_school_payment_totals(NEW.id);
    PERFORM public.log_security_action(
      'AUTO_PAYMENT_RECALCULATION','schools',NEW.id,
      jsonb_build_object('old_participants', OLD.total_participants),
      jsonb_build_object('new_participants', NEW.total_participants,
                         'trigger_reason', 'Student registrations changed'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_recalculate_on_rate_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF (OLD.per_entry_rate IS DISTINCT FROM NEW.per_entry_rate) OR
     (OLD.concession_per_entry IS DISTINCT FROM NEW.concession_per_entry) THEN
    PERFORM public.calculate_expected_amount(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_confirm_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'Received' AND NEW.name_list_status = 'Uploaded' THEN
    IF NEW.registration_status != 'Confirmed' THEN
      NEW.registration_status = 'Confirmed';
      NEW.updated_at = now();
      PERFORM public.log_security_action(
        'AUTO_REGISTRATION_CONFIRMED','schools',NEW.id,
        jsonb_build_object('old_registration_status', OLD.registration_status),
        jsonb_build_object('new_registration_status','Confirmed',
          'payment_status', NEW.payment_status,
          'name_list_status', NEW.name_list_status,
          'trigger_reason','Payment received and name list uploaded'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_update_registration_status_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'Received' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'Received') THEN
    NEW.registration_status = 'Confirmed';
    PERFORM public.log_security_action(
      'AUTO_REGISTRATION_STATUS_UPDATE','schools',NEW.id,
      jsonb_build_object('old_registration_status', OLD.registration_status,'old_payment_status', OLD.payment_status),
      jsonb_build_object('new_registration_status', NEW.registration_status,'new_payment_status', NEW.payment_status,'auto_updated', true));
  END IF;
  RETURN NEW;
END;
$$;

-- Also patch create_payment_transaction_from_workflow to skip during mirror
CREATE OR REPLACE FUNCTION public.create_payment_transaction_from_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user_id uuid; v_existing_transaction_count integer;
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;
  IF (NEW.payment_status IN ('Received','Partial')) AND
     (OLD.payment_status IS NULL OR OLD.payment_status != NEW.payment_status) AND
     NEW.payment_amount IS NOT NULL AND NEW.payment_date IS NOT NULL THEN
    SELECT COUNT(*) INTO v_existing_transaction_count
    FROM public.payment_transactions
    WHERE school_id = NEW.id AND payment_date = NEW.payment_date
      AND payment_amount = NEW.payment_amount AND notes ILIKE '%workflow%';
    IF v_existing_transaction_count = 0 THEN
      v_user_id := COALESCE(auth.uid(),
        (SELECT user_id FROM profiles WHERE role='superadmin' LIMIT 1));
      INSERT INTO public.payment_transactions
        (school_id, payment_date, payment_amount, payment_mode, notes, created_by)
      VALUES (NEW.id, NEW.payment_date, NEW.payment_amount,
        COALESCE(NEW.payment_mode,'Cash'),'Payment recorded via workflow editor', v_user_id);
      PERFORM public.log_security_action(
        'AUTO_PAYMENT_TRANSACTION_CREATED','payment_transactions', NEW.id, NULL,
        jsonb_build_object('school_id', NEW.id,'payment_amount', NEW.payment_amount,
          'payment_date', NEW.payment_date,'trigger_reason','Workflow payment status update'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
