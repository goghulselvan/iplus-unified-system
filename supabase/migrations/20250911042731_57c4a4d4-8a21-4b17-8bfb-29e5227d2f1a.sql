-- Enable pg_cron extension for scheduled backups
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily database backup at 11:00 PM IST (17:30 UTC)
SELECT cron.schedule(
  'daily-database-backup',
  '30 17 * * *', -- 11:00 PM IST = 17:30 UTC
  $$
  SELECT
    net.http_post(
        url:='https://fydtsyawtimoypnekvma.supabase.co/functions/v1/database-backup',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZHRzeWF3dGltb3lwbmVrdm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NzkxODksImV4cCI6MjA3MTE1NTE4OX0._EIHa9SKXRzisUmh7iMpsUCiy3p_W7VZl3MUEHGpfC0"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);