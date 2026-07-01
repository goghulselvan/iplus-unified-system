
-- 1a. audit_schools_pii_access ----------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_schools_pii_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pii_columns text[] := ARRAY['email', 'mobile1', 'mobile2', 'contact_person_name'];
  operation_type text;
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    operation_type := 'INSERT';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    operation_type := 'UPDATE';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    operation_type := 'DELETE';
    PERFORM public.log_pii_access('schools', operation_type, pii_columns);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

-- 1b. detect_bulk_operations ------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_bulk_operations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recent_operations_count integer;
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT COUNT(*) INTO recent_operations_count
  FROM public.security_audit_logs
  WHERE user_id = auth.uid()
    AND created_at > NOW() - INTERVAL '5 minutes'
    AND action LIKE '%' || TG_TABLE_NAME || '%';

  IF recent_operations_count > 10 THEN
    PERFORM public.log_security_action(
      'BULK_OPERATION_DETECTED',
      TG_TABLE_NAME,
      CASE
        WHEN TG_OP = 'INSERT' THEN NEW.id
        WHEN TG_OP = 'UPDATE' THEN NEW.id
        WHEN TG_OP = 'DELETE' THEN OLD.id
        ELSE NULL
      END,
      NULL,
      jsonb_build_object('operation_count', recent_operations_count, 'time_window', '5 minutes')
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- 1c. validate_school_basic_details_update ----------------------------------
CREATE OR REPLACE FUNCTION public.validate_school_basic_details_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  protected_fields text[] := ARRAY['ss_no', 'school_name', 'school_address', 'district', 'state', 'board', 'mobile1', 'mobile2', 'email', 'contact_person_name', 'pincode'];
  field_name text;
  user_role user_role;
  is_manual_edit boolean := false;
BEGIN
  IF COALESCE(current_setting('app.workflow_mirror', true), 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO user_role FROM public.profiles WHERE user_id = auth.uid();
  SELECT COALESCE(current_setting('app.manual_edit_mode', true), 'false')::boolean INTO is_manual_edit;

  IF user_role IN ('superadmin', 'manager') AND is_manual_edit THEN
    PERFORM public.log_security_action('MANUAL_SCHOOL_EDIT', 'schools', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;

  FOREACH field_name IN ARRAY protected_fields
  LOOP
    IF OLD IS NULL OR
       (field_name = 'ss_no' AND OLD.ss_no IS DISTINCT FROM NEW.ss_no) OR
       (field_name = 'school_name' AND OLD.school_name IS DISTINCT FROM NEW.school_name) OR
       (field_name = 'school_address' AND OLD.school_address IS DISTINCT FROM NEW.school_address) OR
       (field_name = 'district' AND OLD.district IS DISTINCT FROM NEW.district) OR
       (field_name = 'state' AND OLD.state IS DISTINCT FROM NEW.state) OR
       (field_name = 'board' AND OLD.board IS DISTINCT FROM NEW.board) OR
       (field_name = 'mobile1' AND OLD.mobile1 IS DISTINCT FROM NEW.mobile1) OR
       (field_name = 'mobile2' AND OLD.mobile2 IS DISTINCT FROM NEW.mobile2) OR
       (field_name = 'email' AND OLD.email IS DISTINCT FROM NEW.email) OR
       (field_name = 'contact_person_name' AND OLD.contact_person_name IS DISTINCT FROM NEW.contact_person_name) OR
       (field_name = 'pincode' AND OLD.pincode IS DISTINCT FROM NEW.pincode) THEN
      IF NOT is_manual_edit OR user_role NOT IN ('superadmin', 'manager') THEN
        RAISE EXCEPTION 'Protected field "%" cannot be modified automatically. Manual edit required. Use the edit button to modify basic school details.', field_name;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2. Enforce one active olympiad project at a time --------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_olympiad_projects_one_active
  ON public.olympiad_projects (is_active)
  WHERE is_active = true;

-- 3. Bulk-volume composite indexes ------------------------------------------
CREATE INDEX IF NOT EXISTS idx_spw_project_reg_status   ON public.school_project_workflow (project_id, registration_status);
CREATE INDEX IF NOT EXISTS idx_spw_project_payment      ON public.school_project_workflow (project_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_spw_project_contacted    ON public.school_project_workflow (project_id, contacted);
CREATE INDEX IF NOT EXISTS idx_spw_project_name_list    ON public.school_project_workflow (project_id, name_list_status);
CREATE INDEX IF NOT EXISTS idx_spw_project_courier      ON public.school_project_workflow (project_id, courier_status);

CREATE INDEX IF NOT EXISTS idx_student_reg_project_created   ON public.student_registrations (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_reg_project_school    ON public.student_registrations (project_id, school_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_project_created    ON public.payment_transactions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_project_created ON public.activity_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communications_project_school ON public.communications (project_id, school_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_project_school     ON public.follow_ups (project_id, school_id);
