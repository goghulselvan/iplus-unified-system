-- Two fixes:
-- 1. search_schools_case_insensitive: replace correlated EXISTS with LEFT JOIN,
--    leverage trgm index for ILIKE, fix workflow_filter to read school_project_workflow
--    so it reflects per-project status (not just the global schools columns)
-- 2. get_dashboard_metrics_by_date: fix DATE(updated_at) which bypasses the updated_at
--    index — rewrite to range comparison

-- ============================================================
-- 1. search_schools_case_insensitive — optimized version
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_schools_case_insensitive(
  search_term       text    DEFAULT NULL,
  state_filter      text    DEFAULT NULL,
  district_filter   text    DEFAULT NULL,
  board_filter      text    DEFAULT NULL,
  status_filter     text    DEFAULT NULL,
  workflow_filter   text    DEFAULT NULL,
  payment_filter    text    DEFAULT NULL,
  limit_count       integer DEFAULT 50,
  offset_count      integer DEFAULT 0,
  project_filter    uuid    DEFAULT NULL
)
RETURNS TABLE(
  id uuid, ss_no integer, school_name text, school_address text,
  district text, state text, board text, pincode text,
  contact_person_name text, email text, mobile1 text, mobile2 text,
  courier_status courier_status, contacted contacted_status,
  registration_interest interest_status, registration_interest_comment text,
  consent_form_requested consent_status, consent_form_comment text,
  consent_form_sent text, registration_status registration_status,
  name_list_status name_list_status, payment_status payment_status,
  payment_date date, payment_amount numeric, payment_mode text,
  question_paper_sent question_paper_status, answer_sheet_status answer_sheet_status,
  result_status result_status, total_participants integer,
  brochure_delivery_status brochure_delivery_status,
  current_project_id uuid,
  created_at timestamptz, updated_at timestamptz,
  per_entry_rate numeric, concession_per_entry numeric,
  effective_rate_per_entry numeric, expected_amount numeric,
  payment_received numeric, outstanding_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT s.*,
      -- When project_filter given, use per-project workflow values (COALESCE: workflow wins)
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
    -- JOIN replaces correlated EXISTS — uses UNIQUE(school_id, project_id) index
    LEFT JOIN public.school_project_workflow w
      ON project_filter IS NOT NULL AND w.school_id = s.id AND w.project_id = project_filter
    WHERE
      can_access_school_data(s.district)
      -- Only schools in the selected project (when project_filter is set)
      AND (project_filter IS NULL OR w.id IS NOT NULL)
      -- Text search — trgm index kicks in for school_name at >= 3 chars
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
      -- Workflow filter reads effective (per-project) values
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
$$;

-- ============================================================
-- 2. get_dashboard_metrics_by_date — fix DATE() bypassing index
--    Use range: updated_at >= day_start AND updated_at < day_end
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_date(target_date date)
RETURNS TABLE(
  total_schools bigint, courier_sent bigint, courier_returned bigint,
  contacted_yes bigint, contacted_no bigint,
  registration_interested bigint, registration_not_interested bigint,
  consent_requested bigint, consent_form_sent_total bigint,
  consent_form_sent_physical bigint, consent_form_sent_digital bigint,
  registration_confirmed bigint, name_list_received bigint, name_list_uploaded bigint,
  payment_received bigint, question_paper_sent bigint,
  answer_sheet_received bigint, result_sent bigint,
  communications_count bigint, follow_ups_created bigint, follow_ups_completed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH day_bounds AS (
    SELECT
      target_date::timestamptz                       AS day_start,
      (target_date + interval '1 day')::timestamptz  AS day_end
  ),
  date_metrics AS (
    SELECT
      COUNT(*)                                                               AS total_schools,
      COUNT(*) FILTER (WHERE s.courier_status = 'Sent')                     AS courier_sent,
      COUNT(*) FILTER (WHERE s.courier_status = 'Returned')                 AS courier_returned,
      COUNT(*) FILTER (WHERE s.contacted = 'Yes')                           AS contacted_yes,
      COUNT(*) FILTER (WHERE s.contacted = 'No')                            AS contacted_no,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Interested')        AS registration_interested,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested')    AS registration_not_interested,
      COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes')              AS consent_requested,
      COUNT(*) FILTER (WHERE s.consent_form_sent IN ('Sent','Sent Digitally')) AS consent_form_sent_total,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent')                  AS consent_form_sent_physical,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally')        AS consent_form_sent_digital,
      COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed')           AS registration_confirmed,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received')               AS name_list_received,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded')               AS name_list_uploaded,
      COUNT(*) FILTER (WHERE s.payment_status = 'Received')                 AS payment_received,
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent')                AS question_paper_sent,
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received')            AS answer_sheet_received,
      COUNT(*) FILTER (WHERE s.result_status = 'Sent')                      AS result_sent
    FROM public.schools s, day_bounds
    -- Range comparison: allows idx_schools_updated_at index
    WHERE (s.updated_at >= day_bounds.day_start AND s.updated_at < day_bounds.day_end)
       OR (s.created_at >= day_bounds.day_start AND s.created_at < day_bounds.day_end)
  ),
  activity_metrics AS (
    SELECT
      (SELECT COUNT(*) FROM communications c, day_bounds
        WHERE c.created_at >= day_bounds.day_start AND c.created_at < day_bounds.day_end) AS communications_count,
      (SELECT COUNT(*) FROM follow_ups f, day_bounds
        WHERE f.created_at >= day_bounds.day_start AND f.created_at < day_bounds.day_end) AS follow_ups_created,
      (SELECT COUNT(*) FROM follow_ups f, day_bounds
        WHERE f.updated_at >= day_bounds.day_start AND f.updated_at < day_bounds.day_end
          AND f.status = 'completed') AS follow_ups_completed
  )
  SELECT
    dm.total_schools, dm.courier_sent, dm.courier_returned,
    dm.contacted_yes, dm.contacted_no,
    dm.registration_interested, dm.registration_not_interested,
    dm.consent_requested, dm.consent_form_sent_total,
    dm.consent_form_sent_physical, dm.consent_form_sent_digital,
    dm.registration_confirmed, dm.name_list_received, dm.name_list_uploaded,
    dm.payment_received, dm.question_paper_sent,
    dm.answer_sheet_received, dm.result_sent,
    am.communications_count, am.follow_ups_created, am.follow_ups_completed
  FROM date_metrics dm, activity_metrics am;
$$;
