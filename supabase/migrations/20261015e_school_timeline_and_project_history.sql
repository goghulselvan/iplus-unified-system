-- 2026-10-15 — One communication history per school (prospect popup) + per-project summary.
-- Read-only: nothing is moved or deleted. Keyed by the prospect (every school has one, CRM or not);
-- the CRM school is resolved through schools.prospect_school_id. A row with no project of its own
-- is labelled with the latest project whose year is <= the year it happened (Goghul: all current
-- history = 2026), falling back to the active project.

-- Where a next-year interest lead came from (portal form / removed from a project) + a note.
ALTER TABLE public.olympiad_interest ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal_form';
ALTER TABLE public.olympiad_interest ADD COLUMN IF NOT EXISTS note text;

CREATE OR REPLACE FUNCTION public.project_for_date(p_at timestamptz)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT id FROM olympiad_projects
      WHERE project_year <= extract(year FROM p_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY project_year DESC, is_active DESC LIMIT 1),
    (SELECT id FROM olympiad_projects WHERE is_active ORDER BY project_year DESC LIMIT 1))
$$;

-- p_project_id NULL = all projects. Keyset pagination: pass the last row's happened_at as p_before.
CREATE OR REPLACE FUNCTION public.get_school_timeline(
  p_prospect_school_id uuid, p_project_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (happened_at timestamptz, channel text, direction text, title text, detail text,
               staff_name text, project_id uuid, project_name text, source text, source_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT is_crm_user() AS ok,
           (SELECT id FROM schools WHERE prospect_school_id = p_prospect_school_id LIMIT 1) AS school_id
  ),
  rows AS (
    -- CRM communications (calls, WhatsApp, email logged against the school)
    SELECT c.created_at, lower(c.communication_type::text), c.direction,
           COALESCE(c.template_type, c.communication_type::text) AS title,
           COALESCE(c.ai_summary, c.message) AS detail, c.user_id AS staff,
           COALESCE(c.project_id, project_for_date(c.created_at)) AS pid, 'communications' AS src, c.id::text AS sid
    FROM communications c, me WHERE me.school_id IS NOT NULL AND c.school_id = me.school_id
    UNION ALL
    -- Bonvoice calls not already copied into communications
    SELECT b.created_at, 'call', b.direction,
           COALESCE(b.disposition, b.outcome, b.status, 'Call'),
           COALESCE(b.staff_comment, b.ai_summary, b.speech_content), COALESCE(b.commented_by, b.created_by),
           project_for_date(b.created_at), 'bonvoice_call_logs', b.id::text
    FROM bonvoice_call_logs b, me
    WHERE (b.prospect_school_id = p_prospect_school_id OR (me.school_id IS NOT NULL AND b.school_id = me.school_id))
      AND NOT EXISTS (SELECT 1 FROM communications c WHERE c.bonvoice_call_id = b.call_id)
    UNION ALL
    -- Call campaign entries
    SELECT l.called_at, 'call', 'outbound', 'Call campaign: ' || COALESCE(l.outcome, ''),
           concat_ws(' · ', l.notes, CASE WHEN l.registrations_committed > 0 THEN l.registrations_committed || ' committed' END),
           l.called_by, COALESCE(l.project_id, project_for_date(l.called_at)), 'call_campaign_log', l.id::text
    FROM call_campaign_log l WHERE l.prospect_school_id = p_prospect_school_id
    UNION ALL
    -- Email / WhatsApp campaign sends
    SELECT COALESCE(cs.sent_at, cs.created_at), 'campaign_' || lower(COALESCE(cp.channel, 'email')), 'outbound',
           cp.name, concat_ws(' · ', cs.status, CASE WHEN cs.opened_at IS NOT NULL THEN 'opened' END, cs.error_message),
           cp.created_by, COALESCE(cp.project_id, project_for_date(COALESCE(cs.sent_at, cs.created_at))),
           'campaign_schools', cs.id::text
    FROM campaign_schools cs JOIN campaigns cp ON cp.id = cs.campaign_id
    WHERE cs.prospect_school_id = p_prospect_school_id
    UNION ALL
    -- Follow-ups
    SELECT f.created_at, 'follow_up', NULL, 'Follow-up ' || COALESCE(f.status, '') || ' · ' || f.follow_up_date,
           f.notes, f.created_by, COALESCE(f.project_id, project_for_date(f.created_at)), 'follow_ups', f.id::text
    FROM follow_ups f, me WHERE me.school_id IS NOT NULL AND f.school_id = me.school_id
    UNION ALL
    -- Status changes
    SELECT a.created_at, 'status', NULL, COALESCE(a.field_name, a.activity_type),
           COALESCE(a.description, concat_ws(' → ', a.old_value, a.new_value)), a.user_id,
           COALESCE(a.project_id, project_for_date(a.created_at)), 'activity_logs', a.id::text
    FROM activity_logs a, me WHERE me.school_id IS NOT NULL AND a.school_id = me.school_id
  )
  SELECT r.created_at, r.lower, r.direction, r.title, r.detail,
         pr.full_name, r.pid, op.project_name || ' ' || op.project_year, r.src, r.sid
  FROM rows r(created_at, lower, direction, title, detail, staff, pid, src, sid)
  CROSS JOIN me
  LEFT JOIN profiles pr ON pr.user_id = r.staff
  LEFT JOIN olympiad_projects op ON op.id = r.pid
  WHERE me.ok
    AND (p_project_id IS NULL OR r.pid = p_project_id)
    AND (p_before IS NULL OR r.created_at < p_before)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200)
$$;

-- One row per project the school has any trace in (workflow, interest, students, orders, history).
CREATE OR REPLACE FUNCTION public.get_school_project_history(p_prospect_school_id uuid)
RETURNS TABLE (project_id uuid, project_name text, project_year int, is_active boolean,
               status text, registration_status text, payment_status text, payment_received numeric,
               students bigint, enrolments bigint, book_orders bigint, book_order_total numeric,
               result_status text, interest_note text, communications bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT is_crm_user() AS ok,
           (SELECT id FROM schools WHERE prospect_school_id = p_prospect_school_id LIMIT 1) AS school_id
  )
  SELECT op.id, op.project_name, op.project_year, op.is_active,
    CASE
      WHEN st.n > 0 THEN 'Participated'
      WHEN w.registration_status::text = 'Confirmed' THEN 'Registered'
      WHEN w.id IS NOT NULL AND w.registration_interest::text = 'Interested' THEN 'Interested'
      WHEN w.id IS NOT NULL THEN COALESCE(w.registration_interest::text, 'In pipeline')
      WHEN oi.id IS NOT NULL THEN 'Interested (lead)'
      ELSE 'Contacted only'
    END,
    w.registration_status::text, w.payment_status::text, w.payment_received::numeric,
    COALESCE(st.n, 0), COALESCE(en.n, 0), COALESCE(bo.n, 0), COALESCE(bo.total, 0),
    w.result_status::text, oi.note,
    (SELECT count(*) FROM get_school_timeline(p_prospect_school_id, op.id, NULL, 200))
  FROM me CROSS JOIN olympiad_projects op
  LEFT JOIN school_project_workflow w ON w.school_id = me.school_id AND w.project_id = op.id
  LEFT JOIN LATERAL (SELECT count(*) n FROM portal_registered_students s WHERE s.school_id = me.school_id AND s.project_id = op.id) st ON true
  LEFT JOIN LATERAL (SELECT count(*) n FROM portal_student_enrollments e WHERE e.school_id = me.school_id AND e.project_id = op.id) en ON true
  LEFT JOIN LATERAL (SELECT count(DISTINCT o.id) n, sum(i.quantity * i.unit_price) total
                     FROM product_orders o JOIN product_order_items i ON i.order_id = o.id
                     WHERE o.school_id = me.school_id AND i.line_status <> 'rejected'
                       AND project_for_date(o.created_at) = op.id) bo ON true
  LEFT JOIN LATERAL (SELECT i.id, i.note FROM olympiad_interest i
                     WHERE i.for_year = op.project_year
                       AND (i.prospect_school_id = p_prospect_school_id OR (me.school_id IS NOT NULL AND i.school_id = me.school_id))
                     ORDER BY i.created_at DESC LIMIT 1) oi ON true
  WHERE me.ok
    AND (w.id IS NOT NULL OR oi.id IS NOT NULL OR st.n > 0 OR bo.n > 0
         OR EXISTS (SELECT 1 FROM get_school_timeline(p_prospect_school_id, op.id, NULL, 1)))
  ORDER BY op.project_year DESC
$$;

REVOKE ALL ON FUNCTION public.get_school_timeline(uuid, uuid, timestamptz, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_timeline(uuid, uuid, timestamptz, int) TO authenticated;
REVOKE ALL ON FUNCTION public.get_school_project_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_school_project_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_for_date(timestamptz) TO authenticated;

CREATE INDEX IF NOT EXISTS campaign_schools_prospect_idx ON public.campaign_schools (prospect_school_id);
CREATE INDEX IF NOT EXISTS bonvoice_call_logs_prospect_idx ON public.bonvoice_call_logs (prospect_school_id);
CREATE INDEX IF NOT EXISTS call_campaign_log_prospect_idx ON public.call_campaign_log (prospect_school_id);
