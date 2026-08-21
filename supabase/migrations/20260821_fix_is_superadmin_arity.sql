-- is_superadmin() takes no arguments (it reads auth.uid() internally) — four
-- functions were calling it as is_superadmin(auth.uid()), which doesn't match
-- any real overload and throws "function is_superadmin(uuid) does not exist"
-- the moment they actually run. Found live via the Payment Queue's new Delete
-- button (delete_pending_payment_submission); reject_entire_order has the same
-- bug but was never exercised live yet. is_role_unchanged and
-- validate_sensitive_operation are more serious — a role-change trigger and the
-- bulk-operation authorization gate, both currently crashing for every caller,
-- including superadmins, the moment they're actually invoked.

CREATE OR REPLACE FUNCTION public.delete_pending_payment_submission(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub portal_payment_submissions%ROWTYPE;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only iPlus superadmins can delete a payment submission';
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_sub.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending (not yet acknowledged) submissions can be deleted this way — an acknowledged one already affected the school''s payment total and needs a proper reversal instead';
  END IF;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    auth.uid(), 'PORTAL_PAYMENT_SUBMISSION_DELETED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'amount_paid', v_sub.amount_paid,
      'payment_mode', v_sub.payment_mode, 'payment_date', v_sub.payment_date,
      'screenshot_url', v_sub.screenshot_url
    )
  );

  DELETE FROM portal_payment_submissions WHERE id = p_submission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_entire_order(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only iPlus superadmins can reject an entire order';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE order_id = p_order_id AND line_status = 'pending';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No pending items on this order to reject — items already invoiced, paid or dispatched cannot be rejected this way';
  END IF;

  UPDATE product_order_items
  SET line_status = 'rejected',
      rejected_reason = trim(p_reason),
      rejected_by = auth.uid(),
      rejected_at = now()
  WHERE order_id = p_order_id AND line_status = 'pending';
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_role_unchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow role changes if the user is a superadmin
  IF OLD.role != NEW.role AND NOT is_superadmin() THEN
    RAISE EXCEPTION 'Role changes not permitted';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_sensitive_operation(p_operation text, p_table_name text DEFAULT 'unknown'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  valid_approval RECORD;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    PERFORM public.log_security_action(
      'UNAUTHORIZED_ACCESS_ATTEMPT',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation)
    );
    RETURN false;
  END IF;

  -- Superadmins can always perform all operations (no restrictions)
  IF is_superadmin() THEN
    RETURN true;
  END IF;

  -- Block managers from bulk export and bulk delete operations completely
  IF p_operation IN ('BULK_EXPORT', 'BULK_DELETE') THEN
    PERFORM public.log_security_action(
      'MANAGER_BULK_OPERATION_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object(
        'operation', p_operation,
        'reason', 'Managers not authorized for bulk export/delete operations'
      )
    );
    RETURN false;
  END IF;

  -- Check rate limits for allowed operations
  IF NOT public.check_advanced_rate_limit(auth.uid(), p_operation, 10, 1, 200) THEN
    PERFORM public.log_security_action(
      'RATE_LIMIT_EXCEEDED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object('operation', p_operation)
    );
    RETURN false;
  END IF;

  -- For bulk create registrations and updates, check business hours for managers
  IF p_operation IN ('BULK_CREATE_REGISTRATIONS', 'BULK_UPDATE')
     AND NOT public.is_business_hours() THEN
    PERFORM public.log_security_action(
      'AFTER_HOURS_ACCESS_DENIED',
      p_table_name,
      NULL,
      NULL,
      jsonb_build_object(
        'operation', p_operation,
        'business_hours', '9 AM - 6 PM IST, Mon-Fri'
      )
    );
    RETURN false;
  END IF;

  -- Allow managers to create student registrations during business hours
  IF p_operation = 'BULK_CREATE_REGISTRATIONS' AND is_manager_or_superadmin() THEN
    RETURN true;
  END IF;

  -- Allow managers to do bulk updates during business hours
  IF p_operation = 'BULK_UPDATE' AND is_manager_or_superadmin() THEN
    RETURN true;
  END IF;

  RETURN true;
END;
$function$;
