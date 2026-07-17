-- search_schools_case_insensitive had an explicit column list that never
-- included portal_registered — any searched/filtered school list (the search
-- box, workflow/payment/state/board filters) silently dropped it, showing
-- "Manual" for portal-registered schools even though the unfiltered list
-- (plain select('*')) and School Detail (also select('*')) showed it correctly.
-- Return type changes, so the old function must be dropped first.
DROP FUNCTION IF EXISTS public.search_schools_case_insensitive(text, text, text, text, text, text, text, integer, integer, uuid);

CREATE FUNCTION public.search_schools_case_insensitive(
  search_term text DEFAULT NULL::text, state_filter text DEFAULT NULL::text,
  district_filter text DEFAULT NULL::text, board_filter text DEFAULT NULL::text,
  status_filter text DEFAULT NULL::text, workflow_filter text DEFAULT NULL::text,
  payment_filter text DEFAULT NULL::text, limit_count integer DEFAULT 50,
  offset_count integer DEFAULT 0, project_filter uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  id uuid, ss_no integer, school_name text, school_address text, district text, state text,
  board text, pincode text, contact_person_name text, email text, mobile1 text, mobile2 text,
  courier_status courier_status, contacted contacted_status, registration_interest interest_status,
  registration_interest_comment text, consent_form_requested consent_status, consent_form_comment text,
  consent_form_sent text, registration_status registration_status, name_list_status name_list_status,
  payment_status payment_status, payment_date date, payment_amount numeric, payment_mode text,
  question_paper_sent question_paper_status, answer_sheet_status answer_sheet_status,
  result_status result_status, total_participants integer, brochure_delivery_status brochure_delivery_status,
  current_project_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone,
  per_entry_rate numeric, concession_per_entry numeric, effective_rate_per_entry numeric,
  expected_amount numeric, payment_received numeric, outstanding_balance numeric,
  portal_registered boolean, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
        (workflow_filter = 'payment_received'          AND COALESCE(w.payment_status::text,          s.payment_status::text)           = 'Received') OR
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
    normalize_to_title_case(f.school_address),
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
