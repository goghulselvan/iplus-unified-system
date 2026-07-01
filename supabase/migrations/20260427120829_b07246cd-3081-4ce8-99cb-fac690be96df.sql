CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project_with_access(p_project_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_schools bigint, contacted_yes bigint, contacted_no bigint, registration_interested bigint, registration_not_interested bigint, registration_in_progress bigint, registration_pending bigint, registration_confirmed bigint, consent_requested bigint, consent_form_sent_total bigint, consent_form_sent_physical bigint, consent_form_sent_digital bigint, courier_sent bigint, courier_returned bigint, name_list_received bigint, name_list_uploaded bigint, payment_received bigint, question_paper_sent bigint, answer_sheet_received bigint, result_sent bigint, brochure_physical_only bigint, brochure_digital_sent bigint, brochure_both_physical_digital bigint, total_registrations bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH accessible_schools AS (
    -- Pull per-project status from school_project_workflow when a project is selected.
    -- Fall back to the legacy schools.* columns only when no project is selected.
    SELECT
      s.id AS school_id,
      COALESCE(w.contacted::text,                  s.contacted::text)                  AS s_contacted,
      COALESCE(w.registration_interest::text,      s.registration_interest::text)      AS s_registration_interest,
      COALESCE(w.registration_status::text,        s.registration_status::text)        AS s_registration_status,
      COALESCE(w.consent_form_requested::text,     s.consent_form_requested::text)     AS s_consent_form_requested,
      COALESCE(w.consent_form_sent,                s.consent_form_sent)                AS s_consent_form_sent,
      COALESCE(w.courier_status::text,             s.courier_status::text)             AS s_courier_status,
      COALESCE(w.name_list_status::text,           s.name_list_status::text)           AS s_name_list_status,
      COALESCE(w.payment_status::text,             s.payment_status::text)             AS s_payment_status,
      COALESCE(w.question_paper_sent::text,        s.question_paper_sent::text)        AS s_question_paper_sent,
      COALESCE(w.answer_sheet_status::text,        s.answer_sheet_status::text)        AS s_answer_sheet_status,
      COALESCE(w.result_status::text,              s.result_status::text)              AS s_result_status,
      COALESCE(w.brochure_delivery_status::text,   s.brochure_delivery_status::text)   AS s_brochure_delivery_status
    FROM schools s
    LEFT JOIN school_project_workflow w
      ON w.school_id = s.id
     AND w.project_id = p_project_id
    WHERE can_access_school_data(s.district)
      AND (
        -- When a project is selected: only schools that have a workflow row for this project
        (p_project_id IS NOT NULL AND w.id IS NOT NULL)
        -- When no project filter: show every accessible school (legacy global view)
        OR p_project_id IS NULL
      )
  ),
  registration_count AS (
    SELECT COUNT(ss.id) as cnt
    FROM student_subjects ss
    INNER JOIN student_registrations sr ON ss.registration_id = sr.id
    INNER JOIN accessible_schools a ON a.school_id = sr.school_id
    WHERE (p_project_id IS NULL OR sr.project_id = p_project_id)
      AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%'
  )
  SELECT
    COUNT(*)::bigint AS total_schools,
    COUNT(*) FILTER (WHERE a.s_contacted = 'Yes')::bigint AS contacted_yes,
    COUNT(*) FILTER (WHERE a.s_contacted = 'No')::bigint AS contacted_no,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Interested')::bigint AS registration_interested,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Not Interested')::bigint AS registration_not_interested,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'In Progress')::bigint AS registration_in_progress,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Pending')::bigint AS registration_pending,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Confirmed')::bigint AS registration_confirmed,
    COUNT(*) FILTER (WHERE a.s_consent_form_requested = 'Yes')::bigint AS consent_requested,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent IN ('Sent', 'Sent Digitally'))::bigint AS consent_form_sent_total,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent')::bigint AS consent_form_sent_physical,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent Digitally')::bigint AS consent_form_sent_digital,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Sent')::bigint AS courier_sent,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Returned')::bigint AS courier_returned,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Received')::bigint AS name_list_received,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Uploaded')::bigint AS name_list_uploaded,
    COUNT(*) FILTER (WHERE a.s_payment_status = 'Received')::bigint AS payment_received,
    COUNT(*) FILTER (WHERE a.s_question_paper_sent = 'Sent')::bigint AS question_paper_sent,
    COUNT(*) FILTER (WHERE a.s_answer_sheet_status = 'Received')::bigint AS answer_sheet_received,
    COUNT(*) FILTER (WHERE a.s_result_status = 'Sent')::bigint AS result_sent,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Physical Only')::bigint AS brochure_physical_only,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Digital Sent')::bigint AS brochure_digital_sent,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Both Physical & Digital')::bigint AS brochure_both_physical_digital,
    (SELECT cnt FROM registration_count)::bigint AS total_registrations
  FROM accessible_schools a;
END;
$function$;
