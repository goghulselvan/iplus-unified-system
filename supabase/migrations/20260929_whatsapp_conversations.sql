-- Powers the new "mini WhatsApp Web" WhatsApp tab in Message Centre: a
-- per-phone-number conversation list (left pane) and a full per-phone
-- thread (right pane), aggregated across the three places a WhatsApp
-- message can live today — wa_replies (inbound), communications
-- (outbound template/system sends, WhatsApp channel only), and
-- wa_reply_responses (our new freeform reply sends). Deliberately excludes
-- campaign_schools (bulk campaign sends) — that's a mass one-way send with
-- its own dedicated analytics page, not a real conversation thread, and
-- folding it in would surface hundreds of stale one-off campaign rows as
-- if they were live chats.

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations(p_search text DEFAULT NULL)
 RETURNS TABLE(
   phone text,
   display_name text,
   school_id uuid,
   prospect_school_id uuid,
   last_message text,
   last_at timestamptz,
   last_direction text,
   last_status text,
   unread_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH events AS (
    SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p10,
           message_text AS msg, received_at AS at, 'in'::text AS dir, status AS stat
    FROM wa_replies
    UNION ALL
    SELECT right(regexp_replace(COALESCE(contacted_mobile_no, ''), '\D', '', 'g'), 10),
           message, created_at, 'out', COALESCE(delivery_status, 'sent')
    FROM communications
    WHERE communication_type = 'WhatsApp' AND contacted_mobile_no IS NOT NULL
    UNION ALL
    SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10),
           message_text, created_at, 'out', 'sent'
    FROM wa_reply_responses
  ),
  valid_events AS (SELECT * FROM events WHERE length(p10) = 10),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY p10 ORDER BY at DESC) AS rn
    FROM valid_events
  ),
  latest AS (SELECT * FROM ranked WHERE rn = 1),
  unread AS (
    SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p10, count(*) AS n
    FROM wa_replies WHERE status = 'unread' GROUP BY 1
  ),
  latest_name AS (
    SELECT DISTINCT ON (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10))
      right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p10, sender_name
    FROM wa_replies
    WHERE sender_name IS NOT NULL
    ORDER BY right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10), received_at DESC
  )
  SELECT
    l.p10,
    COALESCE(sc.school_name, ps.school_name, ln.sender_name, l.p10),
    sc.id,
    ps.id,
    l.msg,
    l.at,
    l.dir,
    l.stat,
    COALESCE(u.n, 0)
  FROM latest l
  -- Direct set-based joins on the indexed primary mobile columns, not
  -- match_phone_all() per row — that function's additional_contacts
  -- fallback is an OR+EXISTS over a jsonb array that no index can serve
  -- (confirmed via EXPLAIN: ~100ms/call even with the phone indexes below,
  -- because the OR forces a sequential scan regardless). Calling it once
  -- per conversation (185 today) is what timed out in the first place.
  -- Trade-off: a school/prospect only reachable via a secondary number
  -- stored in additional_contacts won't resolve to a name here — the
  -- conversation still shows, just by phone number instead of by name.
  LEFT JOIN schools sc
    ON right(regexp_replace(COALESCE(sc.mobile1, ''), '\D', '', 'g'), 10) = l.p10
    OR right(regexp_replace(COALESCE(sc.mobile2, ''), '\D', '', 'g'), 10) = l.p10
  LEFT JOIN prospect_schools ps
    ON right(regexp_replace(COALESCE(ps.mobile, ''), '\D', '', 'g'), 10) = l.p10
  LEFT JOIN latest_name ln ON ln.p10 = l.p10
  LEFT JOIN unread u ON u.p10 = l.p10
  WHERE p_search IS NULL OR p_search = ''
    OR l.p10 ILIKE '%' || p_search || '%'
    OR COALESCE(sc.school_name, ps.school_name, ln.sender_name, '') ILIKE '%' || p_search || '%'
  ORDER BY l.at DESC
  LIMIT 500;
$function$;

CREATE OR REPLACE FUNCTION public.get_whatsapp_thread(p_phone text)
 RETURNS TABLE(message text, at timestamptz, direction text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (SELECT right(regexp_replace(p_phone, '\D', '', 'g'), 10) AS p10)
  SELECT message_text AS message, received_at AS at, 'in'::text AS direction, status
  FROM wa_replies, p
  WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = p.p10
  UNION ALL
  SELECT message, created_at, 'out', COALESCE(delivery_status, 'sent')
  FROM communications, p
  WHERE communication_type = 'WhatsApp'
    AND right(regexp_replace(COALESCE(contacted_mobile_no, ''), '\D', '', 'g'), 10) = p.p10
  UNION ALL
  SELECT message_text, created_at, 'out', 'sent'
  FROM wa_reply_responses, p
  WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = p.p10
  ORDER BY at ASC;
$function$;
