-- 20260715_fix_backup_cron_job.sql
-- Remove every existing backup cron job — the old ones all point at the
-- abandoned project fydtsyawtimoypnekvma and have never run against the
-- live database.
DO $$
DECLARE
  job_record RECORD;
BEGIN
  FOR job_record IN
    SELECT jobid FROM cron.job WHERE jobname ILIKE '%backup%'
  LOOP
    PERFORM cron.unschedule(job_record.jobid);
  END LOOP;
END $$;

-- Recreate, pointed at the live project, authenticated via a shared
-- secret header (checked in database-backup/index.ts) instead of a
-- spoofable boolean header. The Authorization bearer is the public
-- anon key — the gateway just needs a valid Supabase JWT to let the
-- request through; the actual privilege check is the secret header.
SELECT cron.schedule(
  'daily-database-backup-11-59-pm-ist',
  '29 18 * * *',
  $$
  SELECT
    net.http_post(
        url := 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/database-backup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4',
          'X-Scheduled-Backup', 'true',
          'X-Scheduled-Backup-Token', '64e13a2e3d3ff22bf541b20318472d1d5bf640960dc94465b9bda9744b1be9fc'
        ),
        body := '{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);
