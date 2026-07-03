-- Voice campaign auto-sender: pg_cron drip every minute for all active voice campaigns
-- Mirrors wa-campaign-auto-sender pattern (which runs every minute for WhatsApp).
-- Also marks remaining read-only RPCs as STABLE.

-- ============================================================
-- 1. Voice campaign auto-sender cron (every minute)
-- ============================================================
SELECT cron.schedule(
  'voice-campaign-auto-sender',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/send-voice-campaign',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4'
    ),
    body := json_build_object('campaign_id', id)::jsonb
  )
  FROM voice_campaigns
  WHERE status = 'sending';
  $$
);

-- ============================================================
-- 2. STABLE volatility markers on read-only RPCs
--    Allows PostgreSQL planner to cache results within a query;
--    at 1000+ concurrent users reduces per-call planner overhead.
-- ============================================================
ALTER FUNCTION public.get_dashboard_metrics_by_project_with_access(uuid) STABLE;
ALTER FUNCTION public.get_dashboard_metrics_by_date(date) STABLE;
ALTER FUNCTION public.get_total_students_count(uuid) STABLE;
ALTER FUNCTION public.search_schools_case_insensitive(
  text, text, text, text, text, text, text, integer, integer, uuid
) STABLE;
