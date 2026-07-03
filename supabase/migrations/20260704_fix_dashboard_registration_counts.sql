-- Fix: dashboard registration counts were reading from old student_registrations/student_subjects tables.
-- All registrations (portal + staff-manual) now live in portal_registered_students + portal_student_enrollments.
-- Fix 1: get_dashboard_metrics_by_project_with_access — registration_count CTE
-- Fix 2: get_total_students_count — count from portal_registered_students

-- =========================================================
-- 1. Dashboard metrics: total_registrations from new tables
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project_with_access(
  p_project_id uuid DEFAULT NULL
)
RETURNS TABLE(
  total_schools bigint,
  contacted_yes bigint,
  contacted_no bigint,
  registration_interested bigint,
  registration_not_interested bigint,
  registration_in_progress bigint,
  registration_pending bigint,
  registration_confirmed bigint,
  consent_requested bigint,
  consent_form_sent_total bigint,
  consent_form_sent_physical bigint,
  consent_form_sent_digital bigint,
  courier_sent bigint,
  courier_returned bigint,
  name_list_received bigint,
  name_list_uploaded bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  brochure_physical_only bigint,
  brochure_digital_sent bigint,
  brochure_both_physical_digital bigint,
  total_registrations bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH accessible_schools AS (
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
      ON w.school_id = s.id AND w.project_id = p_project_id
    WHERE can_access_school_data(s.district)
      AND (
        (p_project_id IS NOT NULL AND w.id IS NOT NULL)
        OR p_project_id IS NULL
      )
  ),
  -- Count enrollments from portal_registered_students/portal_student_enrollments (unified table)
  registration_count AS (
    SELECT COUNT(e.id) AS cnt
    FROM portal_student_enrollments e
    JOIN portal_registered_students r ON r.id = e.student_id
    JOIN accessible_schools a ON a.school_id = r.school_id
    WHERE p_project_id IS NULL OR r.project_id = p_project_id
  )
  SELECT
    COUNT(*)::bigint AS total_schools,
    COUNT(*) FILTER (WHERE a.s_contacted = 'Yes')::bigint,
    COUNT(*) FILTER (WHERE a.s_contacted = 'No')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Interested')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_interest = 'Not Interested')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'In Progress')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Pending')::bigint,
    COUNT(*) FILTER (WHERE a.s_registration_status = 'Confirmed')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_requested = 'Yes')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent IN ('Sent', 'Sent Digitally'))::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_consent_form_sent = 'Sent Digitally')::bigint,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_courier_status = 'Returned')::bigint,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Received')::bigint,
    COUNT(*) FILTER (WHERE a.s_name_list_status = 'Uploaded')::bigint,
    COUNT(*) FILTER (WHERE a.s_payment_status = 'Received')::bigint,
    COUNT(*) FILTER (WHERE a.s_question_paper_sent = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_answer_sheet_status = 'Received')::bigint,
    COUNT(*) FILTER (WHERE a.s_result_status = 'Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Physical Only')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Digital Sent')::bigint,
    COUNT(*) FILTER (WHERE a.s_brochure_delivery_status = 'Both Physical & Digital')::bigint,
    (SELECT cnt FROM registration_count)::bigint AS total_registrations
  FROM accessible_schools a;
END;
$$;

-- =========================================================
-- 2. Total students count from portal_registered_students
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_total_students_count(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_count integer;
  v_user_id uuid := auth.uid();
  v_access_level text;
  v_districts text[];
BEGIN
  SELECT data_access_level, assigned_districts
  INTO v_access_level, v_districts
  FROM public.profiles WHERE user_id = v_user_id;

  SELECT COUNT(DISTINCT r.id) INTO v_count
  FROM public.portal_registered_students r
  JOIN public.schools sc ON sc.id = r.school_id
  WHERE r.project_id = p_project_id
    AND (
      public.is_superadmin(v_user_id)
      OR v_access_level = 'full'
      OR v_access_level IS NULL
      OR (v_access_level = 'regional' AND (
        v_districts IS NULL OR 'ALL' = ANY(v_districts) OR sc.district = ANY(v_districts)
      ))
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_total_students_count(uuid) TO authenticated;

-- =========================================================
-- 3. Save get_portal_registration_summary to version control
--    (already exists in DB — this is the canonical definition)
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_portal_registration_summary(p_project_id uuid)
RETURNS TABLE(school_id uuid, ss_no integer, school_name text, subject_counts jsonb)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    agg.school_id,
    agg.ss_no::integer,
    agg.school_name,
    jsonb_object_agg(agg.olympiad_code, agg.cnt ORDER BY agg.sort) AS subject_counts
  FROM (
    SELECT
      r.school_id, s.ss_no, s.school_name,
      e.olympiad_code,
      COUNT(e.id)::int AS cnt,
      COALESCE(os.subject_code::int, 99) AS sort
    FROM portal_registered_students r
    JOIN schools s ON s.id = r.school_id
    JOIN portal_student_enrollments e ON e.student_id = r.id
    LEFT JOIN olympiad_subjects os
      ON os.alphabetical_code = e.olympiad_code AND os.project_id = p_project_id
    WHERE r.project_id = p_project_id
    GROUP BY r.school_id, s.ss_no, s.school_name, e.olympiad_code, os.subject_code
  ) agg
  GROUP BY agg.school_id, agg.ss_no, agg.school_name
  ORDER BY agg.ss_no;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_registration_summary(uuid) TO authenticated;
