-- 2026-10-16 — Every DB function now reads address1/address2 instead of schools.school_address.
-- Non-destructive: the column and its mirror trigger stay until Goghul approves dropping it.
-- Functions that returned a "school_address" column keep that output name but build it from
-- address1/address2, so nothing consuming them changes.

CREATE OR REPLACE FUNCTION public.approve_order_items(p_order_id uuid, p_item_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_status text;
  v_school_id uuid;
  v_order_payment_mode text;
  v_school_name text;
  v_school_address text;
  v_school_state text;
  v_invoice_payment_method text;
  v_line_items jsonb;
  v_item record;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_count integer;
  v_credit_note_id uuid;
  v_credit_amount numeric;
  v_credit_already_applied boolean;
  v_credit_balance numeric;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT payment_status, school_id, payment_mode, applied_credit_note_id, applied_credit_amount, credit_applied_to_invoice
  INTO v_payment_status, v_school_id, v_order_payment_mode, v_credit_note_id, v_credit_amount, v_credit_already_applied
  FROM product_orders WHERE id = p_order_id;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_payment_status != 'confirmed' THEN
    RAISE EXCEPTION 'Order payment must be confirmed before invoicing';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No items selected';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE id = ANY(p_item_ids) AND order_id = p_order_id AND line_status = 'pending';
  IF v_count != array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected items are not pending on this order';
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.quantity, p.stock_quantity
    FROM product_order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.id = ANY(p_item_ids)
  LOOP
    IF v_item.quantity > v_item.stock_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for one of the selected items — reject it instead';
    END IF;
  END LOOP;

  SELECT school_name, NULLIF(concat_ws(', ', NULLIF(trim(address1), ''), NULLIF(trim(address2), '')), ''), state INTO v_school_name, v_school_address, v_school_state
  FROM schools WHERE id = v_school_id;

  v_invoice_payment_method := CASE v_order_payment_mode
    WHEN 'UPI' THEN 'UPI'
    WHEN 'NEFT' THEN 'Online Transfer'
    ELSE 'Online Transfer'
  END;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'item_name', p.name,
    'hsn_code', p.hsn_code,
    'gst_rate', p.gst_rate,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price
  ))
  INTO v_line_items
  FROM product_order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.id = ANY(p_item_ids);

  v_invoice_result := create_invoice(
    v_school_id, NULL, v_school_name, v_school_address, v_school_state, NULL,
    v_invoice_payment_method, v_line_items
  );
  v_invoice_id := (v_invoice_result->>'id')::uuid;

  UPDATE product_order_items
  SET invoice_id = v_invoice_id, line_status = 'invoiced_unpaid'
  WHERE id = ANY(p_item_ids);

  -- Payment was already verified before approval was possible — mark the
  -- invoice paid immediately. Runs after the UPDATE above so the trigger's
  -- cascade (invoiced_unpaid -> paid) finds the items it needs to flip.
  -- (Restored from the live function — supabase/migrations/20260810_approve_order_items_auto_mark_paid.sql
  -- added this after this plan's original reference copy of approve_order_items was read;
  -- omitting it here would have silently regressed a real, already-shipped fix.)
  PERFORM mark_invoice_paid(v_invoice_id, true);

  IF v_credit_note_id IS NOT NULL THEN
    -- Acquire the lock BEFORE trusting the credit_applied_to_invoice flag at
    -- all — not just before the balance re-check. Two calls approving
    -- different item subsets of the SAME order both reference this order's
    -- credit note, so they serialize on the same advisory-lock key here.
    -- Whichever call gets the lock second must not act on the stale
    -- v_credit_already_applied it captured at function entry (before either
    -- call had committed anything) — it has to look again, now that it's
    -- guaranteed to see the first call's committed write.
    PERFORM pg_advisory_xact_lock(hashtext(v_credit_note_id::text));

    SELECT credit_applied_to_invoice INTO v_credit_already_applied
    FROM product_orders WHERE id = p_order_id;

    IF NOT v_credit_already_applied THEN
      -- Re-validate the credit note's balance here, at the moment it's actually
      -- spent — not just at order-creation time. Two different manual orders can
      -- both reference the same credit note before either is approved (each
      -- independently passed create_manual_product_order's balance check, since
      -- neither had actually consumed anything yet); without this re-check and
      -- lock, both could be approved and both would successfully record a
      -- credit_note_applications row, double-spending the credit. The lock
      -- serializes concurrent approve_order_items calls that reference the same
      -- credit note; the balance re-check catches the case where an earlier,
      -- already-committed order legitimately used up the balance first.
      SELECT remaining_balance INTO v_credit_balance
      FROM credit_notes_with_balance WHERE id = v_credit_note_id;

      IF v_credit_balance < v_credit_amount THEN
        RAISE EXCEPTION 'Credit note no longer has sufficient balance (% remaining, % required) — another order may have already used it; remove or reduce the applied credit on this order and retry',
          v_credit_balance, v_credit_amount;
      END IF;

      INSERT INTO credit_note_applications (credit_note_id, application_type, amount, applied_to_invoice_id, recorded_by)
      VALUES (v_credit_note_id, 'invoice', v_credit_amount, v_invoice_id, auth.uid());

      UPDATE product_orders SET credit_applied_to_invoice = true WHERE id = p_order_id;
    END IF;
  END IF;

  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_schools_with_masked_data()
 RETURNS TABLE(id uuid, ss_no integer, school_name text, school_address text, district text, board text, pincode text, email text, mobile1 text, mobile2 text, contact_person_name text, courier_status courier_status, contacted contacted_status, registration_interest interest_status, registration_interest_comment text, consent_form_requested consent_status, consent_form_comment text, consent_form_sent text, registration_status registration_status, name_list_status name_list_status, payment_status payment_status, payment_date date, payment_amount numeric, payment_mode text, question_paper_sent question_paper_status, answer_sheet_status answer_sheet_status, result_status result_status, total_participants integer, current_project_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH auth_check AS (
    SELECT 
      CASE 
        WHEN auth.uid() IS NULL THEN false
        ELSE true
      END as is_authenticated
  ),
  user_access AS (
    SELECT 
      COALESCE(p.data_access_level, 'limited') as access_level,
      COALESCE(p.role, 'manager') as user_role,
      p.assigned_districts,
      ac.is_authenticated
    FROM auth_check ac
    LEFT JOIN public.profiles p ON (p.user_id = auth.uid() AND ac.is_authenticated = true)
  )
  SELECT 
    s.id,
    s.ss_no,
    s.school_name,
    NULLIF(concat_ws(', ', NULLIF(trim(s.address1), ''), NULLIF(trim(s.address2), '')), ''),
    s.district,
    s.board,
    s.pincode,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.email
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.email
      WHEN s.email IS NOT NULL THEN '***@*****.com'
      ELSE NULL
    END as email,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.mobile1
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.mobile1
      WHEN s.mobile1 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END as mobile1,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.mobile2
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.mobile2
      WHEN s.mobile2 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END as mobile2,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.contact_person_name
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.contact_person_name
      WHEN s.contact_person_name IS NOT NULL THEN '*** *** ***'
      ELSE NULL
    END as contact_person_name,
    s.courier_status,
    s.contacted,
    s.registration_interest,
    s.registration_interest_comment,
    s.consent_form_requested,
    s.consent_form_comment,
    s.consent_form_sent,
    s.registration_status,
    s.name_list_status,
    s.payment_status,
    s.payment_date,
    s.payment_amount,
    s.payment_mode,
    s.question_paper_sent,
    s.answer_sheet_status,
    s.result_status,
    s.total_participants,
    s.current_project_id,
    s.created_at,
    s.updated_at
  FROM public.schools s
  CROSS JOIN user_access ua
  WHERE ua.is_authenticated = true
    AND (
      ua.user_role IN ('superadmin', 'manager') OR
      (ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ))
    );
$function$;

CREATE OR REPLACE FUNCTION public.search_schools_case_insensitive_v2(search_term text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, district_filter text DEFAULT NULL::text, board_filter text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, workflow_filter text DEFAULT NULL::text, payment_filter text DEFAULT NULL::text, project_filter uuid DEFAULT NULL::uuid, limit_count integer DEFAULT 50, offset_count integer DEFAULT 0)
 RETURNS TABLE(id uuid, ss_no integer, school_name text, school_address text, district text, state text, board text, pincode text, contact_person_name text, email text, mobile1 text, mobile2 text, courier_status courier_status, contacted contacted_status, registration_interest interest_status, registration_status registration_status, name_list_status name_list_status, payment_status payment_status, payment_date date, payment_amount numeric, current_project_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, per_entry_rate numeric, expected_amount numeric, payment_received numeric, outstanding_balance numeric, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.ss_no,
    s.school_name,
    NULLIF(concat_ws(', ', NULLIF(trim(s.address1), ''), NULLIF(trim(s.address2), '')), ''),
    s.district,
    s.state,
    s.board,
    s.pincode,
    s.contact_person_name,
    s.email,
    s.mobile1,
    s.mobile2,
    s.courier_status,
    s.contacted,
    s.registration_interest,
    s.registration_status,
    s.name_list_status,
    s.payment_status,
    s.payment_date,
    s.payment_amount,
    s.current_project_id,
    s.created_at,
    s.updated_at,
    s.per_entry_rate,
    s.expected_amount,
    s.payment_received,
    s.outstanding_balance,
    COUNT(*) OVER() as total_count
  FROM schools s
  WHERE 
    (project_filter IS NULL OR s.current_project_id = project_filter)
    AND (search_term IS NULL OR 
         s.ss_no::text = search_term OR
         s.school_name ILIKE '%' || search_term || '%' OR
         s.ss_no::text ILIKE '%' || search_term || '%' OR
         s.district ILIKE '%' || search_term || '%' OR
         s.contact_person_name ILIKE '%' || search_term || '%')
    AND (state_filter IS NULL OR s.state ILIKE state_filter)
    AND (district_filter IS NULL OR s.district ILIKE district_filter)
    AND (board_filter IS NULL OR s.board ILIKE board_filter)
    AND (status_filter IS NULL OR s.registration_status::text = status_filter)
    AND (payment_filter IS NULL OR s.payment_status::text = payment_filter)
    AND (workflow_filter IS NULL OR (
      (workflow_filter = 'courier_sent' AND s.courier_status = 'Sent') OR
      (workflow_filter = 'contacted_yes' AND s.contacted = 'Yes') OR
      (workflow_filter = 'registration_interested' AND s.registration_interest = 'Interested') OR
      (workflow_filter = 'consent_requested' AND s.consent_form_requested = 'Yes') OR
      (workflow_filter = 'registration_confirmed' AND s.registration_status = 'Confirmed') OR
      (workflow_filter = 'name_list_uploaded' AND s.name_list_status = 'Uploaded') OR
      (workflow_filter = 'payment_received' AND s.payment_status = 'Received')
    ))
  ORDER BY 
    CASE 
      WHEN search_term IS NOT NULL AND s.ss_no::text = search_term THEN 1
      WHEN search_term IS NOT NULL AND s.school_name ILIKE search_term || '%' THEN 2
      WHEN search_term IS NOT NULL AND s.school_name ILIKE '%' || search_term || '%' THEN 3
      ELSE 4
    END,
    s.ss_no ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_schools_optimized(p_search_term text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_district text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, ss_no integer, school_name text, school_address text, district text, state text, board text, email text, mobile1 text, mobile2 text, contact_person_name text, registration_status registration_status, payment_status payment_status, name_list_status name_list_status, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    s.id, s.ss_no, s.school_name, NULLIF(concat_ws(', ', NULLIF(trim(s.address1), ''), NULLIF(trim(s.address2), '')), ''), s.district, s.state, s.board,
    s.email, s.mobile1, s.mobile2, s.contact_person_name,
    s.registration_status, s.payment_status, s.name_list_status,
    COUNT(*) OVER() as total_count
  FROM public.schools s
  WHERE 
    (p_search_term IS NULL OR p_search_term = '' OR 
     s.school_name ILIKE '%' || p_search_term || '%' OR 
     s.ss_no::text = p_search_term)
    AND (p_state IS NULL OR p_state = '' OR s.state = p_state)
    AND (p_district IS NULL OR p_district = '' OR s.district = p_district)
    AND (p_status IS NULL OR p_status = '' OR s.registration_status::text = p_status)
  ORDER BY s.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_schools_case_insensitive(search_term text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, district_filter text DEFAULT NULL::text, board_filter text DEFAULT NULL::text, status_filter text DEFAULT NULL::text, workflow_filter text DEFAULT NULL::text, payment_filter text DEFAULT NULL::text, limit_count integer DEFAULT 50, offset_count integer DEFAULT 0, project_filter uuid DEFAULT NULL::uuid, name_list_filter text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, ss_no integer, school_name text, school_address text, address1 text, address2 text, district text, state text, board text, pincode text, contact_person_name text, email text, mobile1 text, mobile2 text, courier_status courier_status, contacted contacted_status, registration_interest interest_status, registration_interest_comment text, consent_form_requested consent_status, consent_form_comment text, consent_form_sent text, registration_status registration_status, name_list_status name_list_status, payment_status payment_status, payment_date date, payment_amount numeric, payment_mode text, question_paper_sent question_paper_status, answer_sheet_status answer_sheet_status, result_status result_status, total_participants integer, brochure_delivery_status brochure_delivery_status, current_project_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, per_entry_rate numeric, concession_per_entry numeric, effective_rate_per_entry numeric, expected_amount numeric, payment_received numeric, outstanding_balance numeric, portal_registered boolean, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT s.*,
      COALESCE(w.contacted::text,               s.contacted::text)               AS eff_contacted,
      COALESCE(w.registration_interest::text,   s.registration_interest::text)   AS eff_reg_interest,
      COALESCE(w.registration_status::text,     s.registration_status::text)     AS eff_reg_status,
      COALESCE(w.consent_form_requested::text,  s.consent_form_requested::text)  AS eff_consent_req,
      COALESCE(w.consent_form_sent,             s.consent_form_sent)             AS eff_consent_sent,
      COALESCE(w.name_list_status::text,        s.name_list_status::text)        AS eff_name_list,
      COALESCE(w.payment_status::text,          s.payment_status::text)          AS eff_payment,
      COALESCE(w.courier_status::text,          s.courier_status::text)          AS eff_courier,
      COALESCE(w.question_paper_sent::text,     s.question_paper_sent::text)     AS eff_qp,
      COALESCE(w.answer_sheet_status::text,     s.answer_sheet_status::text)     AS eff_as,
      COALESCE(w.result_status::text,           s.result_status::text)           AS eff_result,
      COALESCE(w.brochure_delivery_status::text,s.brochure_delivery_status::text)AS eff_brochure
    FROM public.schools s
    LEFT JOIN public.school_project_workflow w
      ON project_filter IS NOT NULL AND w.school_id = s.id AND w.project_id = project_filter
    WHERE
      can_access_school_data(s.district)
      AND (project_filter IS NULL OR w.id IS NOT NULL)
      AND (search_term IS NULL OR
           s.ss_no::text = search_term OR
           s.school_name   ILIKE '%' || search_term || '%' OR
           s.district       ILIKE '%' || search_term || '%' OR
           s.contact_person_name ILIKE '%' || search_term || '%' OR
           s.email          ILIKE '%' || search_term || '%' OR
           s.mobile1        ILIKE '%' || search_term || '%' OR
           s.mobile2        ILIKE '%' || search_term || '%')
      AND (state_filter    IS NULL OR s.state    ILIKE state_filter)
      AND (district_filter IS NULL OR s.district ILIKE district_filter)
      AND (board_filter    IS NULL OR s.board    ILIKE board_filter)
      AND (status_filter   IS NULL OR s.registration_status::text = status_filter)
      AND (payment_filter  IS NULL OR s.payment_status::text = payment_filter)
      AND (name_list_filter IS NULL OR COALESCE(w.name_list_status::text, s.name_list_status::text) = name_list_filter)
      AND (workflow_filter IS NULL OR (
        (workflow_filter = 'courier_sent'              AND COALESCE(w.courier_status::text,          s.courier_status::text)           = 'Sent') OR
        (workflow_filter = 'courier_returned'          AND COALESCE(w.courier_status::text,          s.courier_status::text)           = 'Returned') OR
        (workflow_filter = 'contacted_yes'             AND COALESCE(w.contacted::text,               s.contacted::text)                = 'Yes') OR
        (workflow_filter = 'contacted_no'              AND COALESCE(w.contacted::text,               s.contacted::text)                = 'No') OR
        (workflow_filter = 'registration_interested'   AND COALESCE(w.registration_interest::text,   s.registration_interest::text)    = 'Interested') OR
        (workflow_filter = 'registration_not_interested' AND COALESCE(w.registration_interest::text, s.registration_interest::text)  = 'Not Interested') OR
        (workflow_filter = 'consent_requested'         AND COALESCE(w.consent_form_requested::text,  s.consent_form_requested::text)   = 'Yes') OR
        (workflow_filter = 'registration_confirmed'    AND COALESCE(w.registration_status::text,     s.registration_status::text)      = 'Confirmed') OR
        (workflow_filter = 'registration_pending'      AND COALESCE(w.registration_status::text,     s.registration_status::text)      = 'Pending') OR
        (workflow_filter = 'registration_in_progress'  AND COALESCE(w.registration_status::text,     s.registration_status::text)      = 'In Progress') OR
        (workflow_filter = 'name_list_received'        AND COALESCE(w.name_list_status::text,        s.name_list_status::text)         = 'Received') OR
        (workflow_filter = 'name_list_uploaded'        AND COALESCE(w.name_list_status::text,        s.name_list_status::text)         = 'Uploaded') OR
        (workflow_filter = 'payment_received'          AND COALESCE(w.payment_status::text,          s.payment_status::text)           IN ('Received', 'Overpaid')) OR
        (workflow_filter = 'question_paper_sent'       AND COALESCE(w.question_paper_sent::text,     s.question_paper_sent::text)      = 'Sent') OR
        (workflow_filter = 'answer_sheet_received'     AND COALESCE(w.answer_sheet_status::text,     s.answer_sheet_status::text)      = 'Received') OR
        (workflow_filter = 'result_sent'               AND COALESCE(w.result_status::text,           s.result_status::text)            = 'Sent') OR
        (workflow_filter = 'brochure_digital_sent'     AND COALESCE(w.brochure_delivery_status::text,s.brochure_delivery_status::text) = 'Digital Sent') OR
        (workflow_filter = 'brochure_both_physical_digital' AND COALESCE(w.brochure_delivery_status::text,s.brochure_delivery_status::text) = 'Both Physical & Digital') OR
        (workflow_filter = 'consent_sent_physical'     AND COALESCE(w.consent_form_sent, s.consent_form_sent) = 'Sent') OR
        (workflow_filter = 'consent_sent_digital'      AND COALESCE(w.consent_form_sent, s.consent_form_sent) = 'Sent Digitally') OR
        (workflow_filter = 'consent_sent_total'        AND COALESCE(w.consent_form_sent, s.consent_form_sent) IN ('Sent', 'Sent Digitally'))
      ))
  )
  SELECT
    f.id, f.ss_no,
    normalize_to_title_case(f.school_name),
    normalize_to_title_case(NULLIF(concat_ws(', ', NULLIF(trim(f.address1), ''), NULLIF(trim(f.address2), '')), '')),
    f.address1, f.address2,
    normalize_to_title_case(f.district),
    normalize_to_title_case(f.state),
    normalize_to_title_case(f.board),
    f.pincode,
    normalize_to_title_case(f.contact_person_name),
    lower(f.email),
    f.mobile1, f.mobile2,
    f.courier_status, f.contacted,
    f.registration_interest, f.registration_interest_comment,
    f.consent_form_requested, f.consent_form_comment, f.consent_form_sent,
    f.registration_status, f.name_list_status, f.payment_status,
    f.payment_date, f.payment_amount, f.payment_mode,
    f.question_paper_sent, f.answer_sheet_status, f.result_status,
    f.total_participants, f.brochure_delivery_status,
    f.current_project_id,
    f.created_at, f.updated_at,
    f.per_entry_rate, f.concession_per_entry, f.effective_rate_per_entry,
    f.expected_amount, f.payment_received, f.outstanding_balance,
    f.portal_registered,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered f
  ORDER BY
    CASE
      WHEN search_term IS NOT NULL AND f.ss_no::text = search_term THEN 1
      WHEN search_term IS NOT NULL AND f.school_name ILIKE search_term || '%' THEN 2
      WHEN search_term IS NOT NULL AND f.school_name ILIKE '%' || search_term || '%' THEN 3
      ELSE 4
    END,
    f.updated_at DESC,
    f.ss_no ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_schools_for_invoice(p_query text, p_limit integer DEFAULT 6)
 RETURNS TABLE(source text, id uuid, school_name text, ss_no integer, address text, district text, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  (
    SELECT 'crm', s.id, s.school_name, s.ss_no, NULLIF(concat_ws(', ', NULLIF(trim(s.address1), ''), NULLIF(trim(s.address2), '')), ''), s.district, s.state
    FROM schools s
    WHERE s.school_name ILIKE '%' || p_query || '%'
       OR s.ss_no::text = p_query
    ORDER BY (s.ss_no::text = p_query) DESC, s.school_name
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'prospect', p.id, p.school_name, p.ss_no, p.address, p.district, p.state
    FROM prospect_schools p
    WHERE p.school_name ILIKE '%' || p_query || '%'
       OR p.ss_no::text = p_query
    ORDER BY (p.ss_no::text = p_query) DESC, p.school_name
    LIMIT p_limit
  )
$function$;

CREATE OR REPLACE FUNCTION public.update_school_with_manual_edit(p_school_id uuid, p_updates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  PERFORM set_config('app.manual_edit_mode', 'true', true);

  UPDATE public.schools SET
    ss_no            = COALESCE((p_updates->>'ss_no')::integer, ss_no),
    school_name      = COALESCE(p_updates->>'school_name', school_name),
    district         = COALESCE(p_updates->>'district', district),
    state            = COALESCE(p_updates->>'state', state),
    board            = COALESCE(p_updates->>'board', board),
    pincode          = COALESCE(p_updates->>'pincode', pincode),
    email            = CASE WHEN p_updates ? 'email'    THEN NULLIF(p_updates->>'email', '')    ELSE email    END,
    mobile1          = CASE WHEN p_updates ? 'mobile1'  THEN NULLIF(p_updates->>'mobile1', '')  ELSE mobile1  END,
    mobile2          = CASE WHEN p_updates ? 'mobile2'  THEN NULLIF(p_updates->>'mobile2', '')  ELSE mobile2  END,
    contact_person_name = CASE WHEN p_updates ? 'contact_person_name' THEN NULLIF(p_updates->>'contact_person_name','') ELSE contact_person_name END,
    address1         = CASE WHEN p_updates ? 'address1' THEN NULLIF(p_updates->>'address1', '') ELSE address1 END,
    address2         = CASE WHEN p_updates ? 'address2' THEN NULLIF(p_updates->>'address2', '') ELSE address2 END,
    corr_name        = CASE WHEN p_updates ? 'corr_name'        THEN NULLIF(p_updates->>'corr_name', '')        ELSE corr_name        END,
    corr_mobile      = CASE WHEN p_updates ? 'corr_mobile'      THEN NULLIF(p_updates->>'corr_mobile', '')      ELSE corr_mobile      END,
    principal_name   = CASE WHEN p_updates ? 'principal_name'   THEN NULLIF(p_updates->>'principal_name', '')   ELSE principal_name   END,
    principal_mobile = CASE WHEN p_updates ? 'principal_mobile' THEN NULLIF(p_updates->>'principal_mobile', '') ELSE principal_mobile END,
    iplus_coordinator= CASE WHEN p_updates ? 'iplus_coordinator'THEN NULLIF(p_updates->>'iplus_coordinator','') ELSE iplus_coordinator END,
    coord_mobile     = CASE WHEN p_updates ? 'coord_mobile'     THEN NULLIF(p_updates->>'coord_mobile', '')     ELSE coord_mobile     END,
    teacher_epo      = CASE WHEN p_updates ? 'teacher_epo'      THEN NULLIF(p_updates->>'teacher_epo', '')      ELSE teacher_epo      END,
    teacher_epo_mob  = CASE WHEN p_updates ? 'teacher_epo_mob'  THEN NULLIF(p_updates->>'teacher_epo_mob', '')  ELSE teacher_epo_mob  END,
    teacher_mpo      = CASE WHEN p_updates ? 'teacher_mpo'      THEN NULLIF(p_updates->>'teacher_mpo', '')      ELSE teacher_mpo      END,
    teacher_mpo_mob  = CASE WHEN p_updates ? 'teacher_mpo_mob'  THEN NULLIF(p_updates->>'teacher_mpo_mob', '')  ELSE teacher_mpo_mob  END,
    teacher_spo      = CASE WHEN p_updates ? 'teacher_spo'      THEN NULLIF(p_updates->>'teacher_spo', '')      ELSE teacher_spo      END,
    teacher_spo_mob  = CASE WHEN p_updates ? 'teacher_spo_mob'  THEN NULLIF(p_updates->>'teacher_spo_mob', '')  ELSE teacher_spo_mob  END,
    teacher_gksspo   = CASE WHEN p_updates ? 'teacher_gksspo'   THEN NULLIF(p_updates->>'teacher_gksspo', '')   ELSE teacher_gksspo   END,
    teacher_gksspo_mob=CASE WHEN p_updates ? 'teacher_gksspo_mob'THEN NULLIF(p_updates->>'teacher_gksspo_mob','')ELSE teacher_gksspo_mob END,
    teacher_lrpo     = CASE WHEN p_updates ? 'teacher_lrpo'     THEN NULLIF(p_updates->>'teacher_lrpo', '')     ELSE teacher_lrpo     END,
    teacher_lrpo_mob = CASE WHEN p_updates ? 'teacher_lrpo_mob' THEN NULLIF(p_updates->>'teacher_lrpo_mob', '') ELSE teacher_lrpo_mob END,
    teacher_kidspo   = CASE WHEN p_updates ? 'teacher_kidspo'   THEN NULLIF(p_updates->>'teacher_kidspo', '')   ELSE teacher_kidspo   END,
    teacher_kidspo_mob=CASE WHEN p_updates ? 'teacher_kidspo_mob'THEN NULLIF(p_updates->>'teacher_kidspo_mob','')ELSE teacher_kidspo_mob END,
    courier_status            = COALESCE((p_updates->>'courier_status')::courier_status, courier_status),
    contacted                 = COALESCE((p_updates->>'contacted')::contacted_status, contacted),
    registration_interest     = COALESCE((p_updates->>'registration_interest')::interest_status, registration_interest),
    registration_interest_comment = CASE WHEN p_updates ? 'registration_interest_comment' THEN NULLIF(p_updates->>'registration_interest_comment','') ELSE registration_interest_comment END,
    consent_form_requested    = COALESCE((p_updates->>'consent_form_requested')::consent_status, consent_form_requested),
    consent_form_comment      = CASE WHEN p_updates ? 'consent_form_comment' THEN NULLIF(p_updates->>'consent_form_comment','') ELSE consent_form_comment END,
    consent_form_sent         = COALESCE(p_updates->>'consent_form_sent', consent_form_sent),
    registration_status       = COALESCE((p_updates->>'registration_status')::registration_status, registration_status),
    name_list_status          = COALESCE((p_updates->>'name_list_status')::name_list_status, name_list_status),
    payment_status            = COALESCE((p_updates->>'payment_status')::payment_status, payment_status),
    payment_date              = COALESCE((p_updates->>'payment_date')::date, payment_date),
    payment_amount            = COALESCE((p_updates->>'payment_amount')::numeric, payment_amount),
    payment_mode              = COALESCE(p_updates->>'payment_mode', payment_mode),
    question_paper_sent       = COALESCE((p_updates->>'question_paper_sent')::question_paper_status, question_paper_sent),
    answer_sheet_status       = COALESCE((p_updates->>'answer_sheet_status')::answer_sheet_status, answer_sheet_status),
    result_status             = COALESCE((p_updates->>'result_status')::result_status, result_status),
    total_participants        = COALESCE((p_updates->>'total_participants')::integer, total_participants),
    brochure_delivery_status  = COALESCE((p_updates->>'brochure_delivery_status')::brochure_delivery_status, brochure_delivery_status),
    current_project_id        = COALESCE(NULLIF(p_updates->>'current_project_id', '')::uuid, current_project_id),
    updated_at                = now()
  WHERE id = p_school_id;

  -- Get the school's current project to sync workflow fields
  SELECT current_project_id INTO v_project_id FROM schools WHERE id = p_school_id;

  -- Sync project-specific workflow fields into school_project_workflow so dashboard metrics are accurate
  IF v_project_id IS NOT NULL THEN
    UPDATE school_project_workflow SET
      contacted             = CASE WHEN p_updates ? 'contacted'             THEN (p_updates->>'contacted')::contacted_status             ELSE contacted             END,
      registration_interest = CASE WHEN p_updates ? 'registration_interest' THEN (p_updates->>'registration_interest')::interest_status  ELSE registration_interest END,
      consent_form_requested= CASE WHEN p_updates ? 'consent_form_requested'THEN (p_updates->>'consent_form_requested')::consent_status   ELSE consent_form_requested END,
      consent_form_sent     = CASE WHEN p_updates ? 'consent_form_sent'     THEN p_updates->>'consent_form_sent'                          ELSE consent_form_sent     END,
      registration_status   = CASE WHEN p_updates ? 'registration_status'   THEN (p_updates->>'registration_status')::registration_status ELSE registration_status   END,
      name_list_status      = CASE WHEN p_updates ? 'name_list_status'      THEN (p_updates->>'name_list_status')::name_list_status       ELSE name_list_status      END,
      payment_status        = CASE WHEN p_updates ? 'payment_status'        THEN (p_updates->>'payment_status')::payment_status           ELSE payment_status        END,
      payment_amount        = CASE WHEN p_updates ? 'payment_amount'        THEN (p_updates->>'payment_amount')::numeric                  ELSE payment_amount        END,
      payment_mode          = CASE WHEN p_updates ? 'payment_mode'          THEN p_updates->>'payment_mode'                               ELSE payment_mode          END,
      courier_status        = CASE WHEN p_updates ? 'courier_status'        THEN (p_updates->>'courier_status')::courier_status           ELSE courier_status        END,
      question_paper_sent   = CASE WHEN p_updates ? 'question_paper_sent'   THEN (p_updates->>'question_paper_sent')::question_paper_status ELSE question_paper_sent END,
      answer_sheet_status   = CASE WHEN p_updates ? 'answer_sheet_status'   THEN (p_updates->>'answer_sheet_status')::answer_sheet_status ELSE answer_sheet_status   END,
      result_status         = CASE WHEN p_updates ? 'result_status'         THEN (p_updates->>'result_status')::result_status             ELSE result_status         END,
      brochure_delivery_status = CASE WHEN p_updates ? 'brochure_delivery_status' THEN (p_updates->>'brochure_delivery_status')::brochure_delivery_status ELSE brochure_delivery_status END
    WHERE school_id = p_school_id AND project_id = v_project_id;
  END IF;

  PERFORM set_config('app.manual_edit_mode', 'false', true);
  PERFORM public.log_security_action('MANUAL_SCHOOL_EDIT', 'schools', p_school_id, NULL, p_updates);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_interest_leads_to_project(p_interest_ids bigint[], p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id        bigint;
  v_lead      olympiad_interest%ROWTYPE;
  v_ps        prospect_schools%ROWTYPE;
  v_school_id uuid;
  v_imported  int := 0;
  v_not_link  int := 0;
  v_already   int := 0;
  v_results   jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM olympiad_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  IF p_interest_ids IS NULL OR array_length(p_interest_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No leads selected';
  END IF;

  FOREACH v_id IN ARRAY p_interest_ids LOOP
    SELECT * INTO v_lead FROM olympiad_interest WHERE id = v_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_lead.converted_at IS NOT NULL THEN
      v_already := v_already + 1;
      v_results := v_results || jsonb_build_object('id', v_id, 'result', 'already_imported');
      CONTINUE;
    END IF;
    IF v_lead.prospect_school_id IS NULL THEN
      v_not_link := v_not_link + 1;
      v_results := v_results || jsonb_build_object('id', v_id, 'result', 'not_linked');
      CONTINUE;
    END IF;

    -- find or create the CRM schools row for this prospect
    SELECT id INTO v_school_id FROM schools WHERE prospect_school_id = v_lead.prospect_school_id LIMIT 1;
    IF v_school_id IS NULL THEN
      SELECT * INTO v_ps FROM prospect_schools WHERE id = v_lead.prospect_school_id;
      -- schools has NOT-NULL district/pincode; interest-form
      -- prospects may lack them, and an explicit NULL overrides the '' default.
      INSERT INTO schools (school_name, ss_no, district, state, board, mobile1, email, address1, pincode, prospect_school_id)
      VALUES (v_ps.school_name, v_ps.ss_no, COALESCE(v_ps.district, ''), v_ps.state, v_ps.board, v_ps.mobile, v_ps.email,
              NULLIF(trim(v_ps.address), ''), COALESCE(v_ps.pincode, ''), v_lead.prospect_school_id)
      RETURNING id INTO v_school_id;
    END IF;

    -- start the workflow for this project (don't clobber an existing row)
    INSERT INTO school_project_workflow (school_id, project_id, registration_status, registration_interest, contacted)
    VALUES (v_school_id, p_project_id, 'Pending', 'Interested', 'Yes')
    ON CONFLICT (school_id, project_id) DO NOTHING;

    UPDATE prospect_schools
    SET stage = 'interested', linked_to_crm = true
    WHERE id = v_lead.prospect_school_id AND COALESCE(stage, 'uncontacted') = 'uncontacted';

    UPDATE olympiad_interest
    SET converted_at = now(), school_id = v_school_id, updated_at = now()
    WHERE id = v_id;

    v_imported := v_imported + 1;
    v_results := v_results || jsonb_build_object('id', v_id, 'result', 'imported', 'school_id', v_school_id);
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped_not_linked', v_not_link,
    'skipped_already', v_already,
    'results', v_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_school_basic_details_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  protected_fields text[] := ARRAY['ss_no', 'school_name', 'address1', 'address2', 'district', 'state', 'board', 'mobile1', 'mobile2', 'email', 'contact_person_name', 'pincode'];
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
       (field_name = 'address1' AND OLD.address1 IS DISTINCT FROM NEW.address1) OR
      (field_name = 'address2' AND OLD.address2 IS DISTINCT FROM NEW.address2) OR
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
