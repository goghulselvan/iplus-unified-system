-- Fix the automatic backup cron job to use service role key instead of anon key
-- First, remove the existing job
SELECT cron.unschedule('daily-database-backup');

-- Create a new job with proper service role authentication
SELECT cron.schedule(
  'daily-database-backup',
  '0 2 * * *', -- Run daily at 2:00 AM UTC
  $$
  SELECT
    net.http_post(
        url:='https://fydtsyawtimoypnekvma.supabase.co/functions/v1/database-backup',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZHRzeWF3dGltb3lwbmVrdm1hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTU3OTE4OSwiZXhwIjoyMDcxMTU1MTg5fQ.vCf7nZUzYl8qBmKofy_NmGP7N9cSQXimRbqzQuS2O3s"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);