-- First, check if pg_cron extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing backup cron jobs
SELECT cron.unschedule('database-backup-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'database-backup-daily'
);

-- Schedule daily backup at 11:59 PM IST (18:29 UTC)
-- IST is UTC+5:30, so 11:59 PM IST = 6:29 PM UTC
SELECT cron.schedule(
  'database-backup-daily',
  '29 18 * * *', -- 6:29 PM UTC = 11:59 PM IST
  $$
  SELECT
    net.http_post(
        url:='https://fydtsyawtimoypnekvma.supabase.co/functions/v1/database-backup',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZHRzeWF3dGltb3lwbmVrdm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NzkxODksImV4cCI6MjA3MTE1NTE4OX0._EIHa9SKXRzisUmh7iMpsUCiy3p_W7VZl3MUEHGpfC0"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);