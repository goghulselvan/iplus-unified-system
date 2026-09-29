-- Adds the wa_replies row id to each inbound thread event (null for outbound
-- rows, which have no wa_replies row) — the chat UI needs this to: (a) know
-- which specific reply to mark "replied" when the reply box sends, (b) check
-- the 24-hour window against the exact inbound message it's answering, and
-- (c) bulk-mark unread inbound messages "read" the moment a conversation is
-- opened, the same way a real chat app would.
DROP FUNCTION IF EXISTS public.get_whatsapp_thread(text);

CREATE FUNCTION public.get_whatsapp_thread(p_phone text)
 RETURNS TABLE(id uuid, message text, at timestamptz, direction text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (SELECT right(regexp_replace(p_phone, '\D', '', 'g'), 10) AS p10)
  SELECT wa_replies.id, message_text AS message, received_at AS at, 'in'::text AS direction, status
  FROM wa_replies, p
  WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = p.p10
  UNION ALL
  SELECT NULL::uuid, message, created_at, 'out', COALESCE(delivery_status, 'sent')
  FROM communications, p
  WHERE communication_type = 'WhatsApp'
    AND right(regexp_replace(COALESCE(contacted_mobile_no, ''), '\D', '', 'g'), 10) = p.p10
  UNION ALL
  SELECT NULL::uuid, message_text, created_at, 'out', 'sent'
  FROM wa_reply_responses, p
  WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = p.p10
  ORDER BY at ASC;
$function$;
