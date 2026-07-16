CREATE OR REPLACE FUNCTION get_followup_queue()
RETURNS TABLE (
  id uuid, phone_last10 text, school_id uuid, prospect_school_id uuid,
  state text, assigned_to uuid, assigned_name text, snoozed_until timestamptz,
  school_name text, missed_count bigint, last_missed_at timestamptz,
  outbound_attempts bigint, followup_status text, burst boolean,
  after_hours boolean, long_ring boolean, priority text, latest_comment text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH calls AS (
    SELECT right(regexp_replace(coalesce(c.school_phone,''),'\D','','g'),10) AS last10,
           c.direction, c.status, c.call_duration, c.start_time, c.end_time,
           c.created_at, c.staff_comment, c.commented_at
    FROM bonvoice_call_logs c
  ),
  agg AS (
    SELECT last10,
      COUNT(*) FILTER (WHERE direction='inbound' AND status='no_answer') AS n_missed,
      MAX(COALESCE(start_time, created_at)) FILTER (WHERE direction='inbound' AND status='no_answer') AS t_last_missed,
      COUNT(*) FILTER (WHERE direction='outbound') AS n_out,
      MAX(COALESCE(EXTRACT(EPOCH FROM (end_time - start_time)), 0)) FILTER (WHERE status='no_answer') AS max_ring
    FROM calls GROUP BY last10
  ),
  bursts AS (
    SELECT last10, bool_or(gap <= interval '10 minutes') AS is_burst
    FROM (
      SELECT last10,
             COALESCE(start_time, created_at)
               - lag(COALESCE(start_time, created_at)) OVER (PARTITION BY last10 ORDER BY COALESCE(start_time, created_at)) AS gap
      FROM calls WHERE direction='inbound' AND status='no_answer'
    ) g GROUP BY last10
  ),
  latest_comments AS (
    SELECT DISTINCT ON (last10) last10, staff_comment
    FROM calls WHERE staff_comment IS NOT NULL AND staff_comment <> ''
    ORDER BY last10, commented_at DESC NULLS LAST
  )
  SELECT f.id, f.phone_last10, f.school_id, f.prospect_school_id, f.state,
    f.assigned_to, p.full_name, f.snoozed_until,
    COALESCE(s.school_name, ps.school_name),
    COALESCE(a.n_missed, 0), a.t_last_missed, COALESCE(a.n_out, 0),
    CASE WHEN COALESCE(a.n_out,0) = 0 THEN 'never_tried' ELSE 'attempted_not_connected' END,
    COALESCE(b.is_burst, false),
    (a.t_last_missed IS NOT NULL AND (
      EXTRACT(HOUR FROM a.t_last_missed AT TIME ZONE 'Asia/Kolkata') < 9 OR
      EXTRACT(HOUR FROM a.t_last_missed AT TIME ZONE 'Asia/Kolkata') >= 19)),
    COALESCE(a.max_ring, 0) >= 120,
    CASE
      WHEN COALESCE(a.n_out,0) > 0 THEN 'Medium'
      WHEN COALESCE(b.is_burst,false) OR COALESCE(a.max_ring,0) >= 120 THEN 'Critical'
      ELSE 'High'
    END,
    lc.staff_comment
  FROM call_followups f
  LEFT JOIN agg a ON a.last10 = f.phone_last10
  LEFT JOIN bursts b ON b.last10 = f.phone_last10
  LEFT JOIN latest_comments lc ON lc.last10 = f.phone_last10
  LEFT JOIN schools s ON s.id = f.school_id
  LEFT JOIN prospect_schools ps ON ps.id = f.prospect_school_id
  LEFT JOIN profiles p ON p.user_id = f.assigned_to
  WHERE f.state = 'open' OR (f.state = 'snoozed' AND f.snoozed_until <= now())
  ORDER BY CASE
      WHEN COALESCE(a.n_out,0) > 0 THEN 2
      WHEN COALESCE(b.is_burst,false) OR COALESCE(a.max_ring,0) >= 120 THEN 0
      ELSE 1
    END,
    a.t_last_missed DESC NULLS LAST;
END;
$$;
