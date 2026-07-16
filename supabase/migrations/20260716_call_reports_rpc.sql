CREATE OR REPLACE FUNCTION get_call_reports(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH calls AS (
    SELECT c.*,
           right(regexp_replace(coalesce(c.school_phone,''),'\D','','g'),10) AS last10,
           COALESCE(c.start_time, c.created_at) AS t
    FROM bonvoice_call_logs c
    WHERE COALESCE(c.start_time, c.created_at) >= p_from
      AND COALESCE(c.start_time, c.created_at) < p_to + 1
  ),
  totals AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
      COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
      COUNT(*) FILTER (WHERE COALESCE(call_duration,0) > 0) AS connected,
      COUNT(*) FILTER (WHERE direction = 'inbound' AND status = 'no_answer') AS missed
    FROM calls
  ),
  daily AS (
    SELECT jsonb_agg(d ORDER BY d->>'day') AS rows FROM (
      SELECT jsonb_build_object(
        'day', to_char(t AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'),
        'inbound', COUNT(*) FILTER (WHERE direction = 'inbound'),
        'outbound', COUNT(*) FILTER (WHERE direction = 'outbound'),
        'missed', COUNT(*) FILTER (WHERE direction = 'inbound' AND status = 'no_answer'),
        'connected', COUNT(*) FILTER (WHERE COALESCE(call_duration,0) > 0)
      ) AS d
      FROM calls
      GROUP BY to_char(t AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
    ) x
  ),
  staff AS (
    SELECT jsonb_agg(s ORDER BY (s->>'outbound')::int DESC) AS rows FROM (
      SELECT jsonb_build_object(
        'user_id', c.created_by,
        'name', COALESCE(p.full_name, p.username, 'Unknown'),
        'outbound', COUNT(*),
        'connected', COUNT(*) FILTER (WHERE COALESCE(c.call_duration,0) > 0),
        'talk_seconds', COALESCE(SUM(c.call_duration), 0)
      ) AS s
      FROM calls c
      LEFT JOIN profiles p ON p.user_id = c.created_by
      WHERE c.direction = 'outbound' AND c.created_by IS NOT NULL
      GROUP BY c.created_by, p.full_name, p.username
    ) x
  ),
  first_missed AS (
    SELECT last10, MIN(t) AS t_missed
    FROM calls
    WHERE direction = 'inbound' AND status = 'no_answer' AND length(last10) = 10
    GROUP BY last10
  ),
  first_callback AS (
    SELECT fm.last10, MIN(c.t) AS t_callback
    FROM first_missed fm
    JOIN calls c ON c.last10 = fm.last10 AND c.direction = 'outbound' AND c.t > fm.t_missed
    GROUP BY fm.last10
  ),
  callback AS (
    SELECT
      (SELECT COUNT(*) FROM first_missed) AS numbers_missed,
      (SELECT COUNT(*) FROM first_callback) AS called_back,
      (SELECT COUNT(*) FROM first_missed) - (SELECT COUNT(*) FROM first_callback) AS never_called_back,
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (fc.t_callback - fm.t_missed)) / 3600)::numeric, 1)
         FROM first_callback fc JOIN first_missed fm ON fm.last10 = fc.last10) AS avg_callback_hours
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'total', t.total, 'inbound', t.inbound, 'outbound', t.outbound,
      'connected', t.connected, 'missed', t.missed,
      'answer_rate_pct', CASE WHEN t.inbound > 0
        THEN ROUND(100.0 * (t.inbound - t.missed) / t.inbound) ELSE NULL END
    ),
    'daily', COALESCE(d.rows, '[]'::jsonb),
    'staff', COALESCE(s.rows, '[]'::jsonb),
    'callback', jsonb_build_object(
      'numbers_missed', cb.numbers_missed, 'called_back', cb.called_back,
      'never_called_back', cb.never_called_back, 'avg_callback_hours', cb.avg_callback_hours
    )
  ) INTO v_result
  FROM totals t, daily d, staff s, callback cb;

  RETURN v_result;
END;
$$;
