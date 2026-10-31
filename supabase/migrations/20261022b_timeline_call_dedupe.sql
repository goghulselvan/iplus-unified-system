CREATE OR REPLACE FUNCTION public.get_school_timeline(
  p_prospect_school_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50)
RETURNS TABLE(happened_at timestamptz, channel text, direction text, title text,
              detail text, staff_name text, project_id uuid, project_name text,
              source text, source_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH me AS (
    SELECT is_crm_user() AS ok,
           (SELECT id FROM schools WHERE prospect_school_id = p_prospect_school_id LIMIT 1) AS school_id
  ),
  rows AS (
    -- CRM communications (calls, WhatsApp, email logged against the school)
    SELECT c.created_at, lower(c.communication_type::text), c.direction,
           COALESCE(c.template_type, c.communication_type::text) AS title,
           concat_ws(E'\n', COALESCE(c.ai_summary, c.message), c.staff_note) AS detail, c.user_id AS staff,
           COALESCE(c.project_id, project_for_date(c.created_at)) AS pid, 'communications' AS src, c.id::text AS sid
    FROM communications c, me WHERE me.school_id IS NOT NULL AND c.school_id = me.school_id
    UNION ALL
    -- Bonvoice calls not already copied into communications
    SELECT b.created_at, 'call', b.direction,
           COALESCE(b.disposition, b.outcome, b.status, 'Call'),
           concat_ws(E'\n', COALESCE(b.ai_summary, b.speech_content), b.staff_comment), COALESCE(b.commented_by, b.created_by),
           project_for_date(b.created_at), 'bonvoice_call_logs', b.id::text
    FROM bonvoice_call_logs b, me
    WHERE (b.prospect_school_id = p_prospect_school_id OR (me.school_id IS NOT NULL AND b.school_id = me.school_id))
      AND NOT EXISTS (
            SELECT 1 FROM communications c
            WHERE c.bonvoice_call_id = b.call_id
               -- bonvoice_call_id is set on only 928 of 2,204 phone rows, so the
               -- id match alone lets the same call appear twice: once from the
               -- CRM page's client-side insert and once from the call log. Fall
               -- back to matching the school, the dialled number and a 3-minute
               -- window, which is how the pair is actually created.
               OR (c.school_id = b.school_id
                   AND c.communication_type::text = 'Phone'
                   AND regexp_replace(COALESCE(c.contacted_mobile_no, ''), '\D', '', 'g')
                       = regexp_replace(COALESCE(b.school_phone, ''), '\D', '', 'g')
                   AND c.created_at BETWEEN b.created_at - interval '3 minutes'
                                        AND b.created_at + interval '3 minutes')
          )
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
$fn$;