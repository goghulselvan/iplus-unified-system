-- Message Centre (Phase 1, read-only) — unified WhatsApp + Email feed across
-- CRM schools (communications) and prospects (campaign_schools + wa_replies).

-- 1. Fix get_school_history: selects a non-existent "details" column instead
--    of "message" — was throwing 42703 on every call (ProspectSchoolHistory.tsx).
CREATE OR REPLACE FUNCTION public.get_school_history(p_prospect_school_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_school_id uuid;
  v_result json;
BEGIN
  SELECT id INTO v_school_id FROM schools WHERE prospect_school_id = p_prospect_school_id LIMIT 1;

  IF v_school_id IS NULL THEN
    RETURN json_build_object('projects', '[]'::json, 'communications', '[]'::json, 'total_students', 0, 'total_paid', 0);
  END IF;

  SELECT json_build_object(
    'school_id', v_school_id,
    'projects', (
      SELECT COALESCE(json_agg(p ORDER BY p.project_year DESC), '[]'::json)
      FROM (
        SELECT
          op.project_name,
          op.project_year,
          spw.registration_status,
          spw.payment_status,
          spw.payment_amount,
          spw.payment_date,
          spw.payment_mode,
          spw.name_list_status,
          spw.result_status,
          spw.total_participants,
          (SELECT COUNT(*) FROM student_registrations sr
             WHERE sr.school_id = v_school_id AND sr.project_id = spw.project_id) as student_count
        FROM school_project_workflow spw
        JOIN olympiad_projects op ON op.id = spw.project_id
        WHERE spw.school_id = v_school_id
      ) p
    ),
    'communications', (
      SELECT COALESCE(json_agg(c ORDER BY c.created_at DESC), '[]'::json)
      FROM (
        SELECT communication_type, message, outcome, created_at
        FROM communications
        WHERE school_id = v_school_id
        ORDER BY created_at DESC
        LIMIT 20
      ) c
    ),
    'total_students', (SELECT COUNT(*) FROM student_registrations WHERE school_id = v_school_id),
    'total_paid', (
      SELECT COALESCE(SUM(CAST(payment_amount AS numeric)), 0)
      FROM school_project_workflow
      WHERE school_id = v_school_id AND payment_status IN ('Received', 'Partial')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 2. wa_replies gets a status column so "Needs Reply" has something to filter on.
ALTER TABLE public.wa_replies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unread';
CREATE INDEX IF NOT EXISTS idx_wa_replies_status ON public.wa_replies(status);

-- 3. Unified message feed — the single source of truth for All Messages, Reports,
--    and (via client-side filter by phone/prospect_school_id/school_id) Timeline.
CREATE OR REPLACE FUNCTION public.get_message_feed(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 300)
 RETURNS TABLE (
   source text,
   event_id uuid,
   when_at timestamptz,
   channel text,
   direction text,
   party_name text,
   party_kind text,
   school_id uuid,
   prospect_school_id uuid,
   phone text,
   status text,
   message text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT
      COALESCE(p_from::timestamptz, '1900-01-01'::timestamptz) AS d_start,
      COALESCE(p_to::timestamptz, now()::date) + interval '1 day' AS d_end
  ),
  comm_rows AS (
    SELECT
      'communications'::text AS source,
      c.id AS event_id,
      c.created_at AS when_at,
      c.communication_type::text AS channel,
      COALESCE(c.direction, 'outbound') AS direction,
      s.school_name AS party_name,
      'CRM'::text AS party_kind,
      c.school_id,
      s.prospect_school_id,
      c.contacted_mobile_no AS phone,
      COALESCE(c.delivery_status, c.email_status) AS status,
      c.message
    FROM communications c
    JOIN schools s ON s.id = c.school_id
    CROSS JOIN bounds b
    WHERE c.communication_type IN ('Email', 'WhatsApp')
      AND c.created_at >= b.d_start AND c.created_at < b.d_end
  ),
  campaign_rows AS (
    SELECT
      'campaign_schools'::text AS source,
      cs.id AS event_id,
      COALESCE(cs.sent_at, cs.created_at) AS when_at,
      camp.channel AS channel,
      'outbound'::text AS direction,
      ps.school_name AS party_name,
      'Prospect'::text AS party_kind,
      NULL::uuid AS school_id,
      cs.prospect_school_id,
      CASE WHEN camp.channel = 'whatsapp' THEN ps.mobile ELSE ps.email END AS phone,
      COALESCE(cs.delivery_status, cs.status) AS status,
      camp.name AS message
    FROM campaign_schools cs
    JOIN campaigns camp ON camp.id = cs.campaign_id
    JOIN prospect_schools ps ON ps.id = cs.prospect_school_id
    CROSS JOIN bounds b
    WHERE cs.status NOT IN ('pending', 'skipped')
      AND COALESCE(cs.sent_at, cs.created_at) >= b.d_start AND COALESCE(cs.sent_at, cs.created_at) < b.d_end
  ),
  reply_rows AS (
    SELECT
      'wa_replies'::text AS source,
      r.id AS event_id,
      r.received_at AS when_at,
      'WhatsApp'::text AS channel,
      'inbound'::text AS direction,
      COALESCE(s.school_name, ps.school_name, r.sender_name, 'Unknown') AS party_name,
      CASE WHEN s.id IS NOT NULL THEN 'CRM' ELSE 'Prospect' END AS party_kind,
      s.id AS school_id,
      ps.id AS prospect_school_id,
      r.phone,
      r.status,
      r.message_text AS message
    FROM wa_replies r
    LEFT JOIN campaign_schools cs2 ON cs2.id = r.campaign_school_id
    LEFT JOIN prospect_schools ps ON ps.id = cs2.prospect_school_id
    LEFT JOIN schools s ON s.prospect_school_id = ps.id
    CROSS JOIN bounds b
    WHERE r.received_at >= b.d_start AND r.received_at < b.d_end
  )
  SELECT * FROM comm_rows
  UNION ALL SELECT * FROM campaign_rows
  UNION ALL SELECT * FROM reply_rows
  ORDER BY when_at DESC
  LIMIT p_limit;
$function$;

-- 4. Reports — reuses get_message_feed as the single source of truth.
CREATE OR REPLACE FUNCTION public.get_message_reports(p_from date, p_to date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'totals', (
      SELECT json_build_object(
        'sent', COUNT(*) FILTER (WHERE source IN ('communications', 'campaign_schools')),
        'delivered', COUNT(*) FILTER (WHERE status IN ('delivered', 'read', 'replied')),
        'read', COUNT(*) FILTER (WHERE status IN ('read', 'replied')),
        'replied', COUNT(*) FILTER (WHERE source = 'wa_replies')
      )
      FROM get_message_feed(p_from, p_to, 100000)
    ),
    'daily', (
      SELECT COALESCE(json_agg(d ORDER BY d.day), '[]'::json)
      FROM (
        SELECT when_at::date AS day,
          COUNT(*) FILTER (WHERE lower(channel) = 'whatsapp') AS whatsapp,
          COUNT(*) FILTER (WHERE lower(channel) = 'email') AS email,
          COUNT(*) FILTER (WHERE source = 'wa_replies') AS replies
        FROM get_message_feed(p_from, p_to, 100000)
        GROUP BY 1
      ) d
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
