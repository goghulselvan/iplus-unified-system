-- Clean up all existing database backup cron jobs
DO $$
DECLARE
  job_record RECORD;
BEGIN
  FOR job_record IN 
    SELECT jobid, jobname 
    FROM cron.job 
    WHERE jobname LIKE '%backup%'
  LOOP
    PERFORM cron.unschedule(job_record.jobid);
    RAISE NOTICE 'Deleted cron job: % (ID: %)', job_record.jobname, job_record.jobid;
  END LOOP;
END $$;

-- Create the single correct daily backup job at 11:59 PM IST (6:29 PM UTC)
SELECT cron.schedule(
  'daily-database-backup-11-59-pm-ist',
  '29 18 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://fydtsyawtimoypnekvma.supabase.co/functions/v1/database-backup',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZHRzeWF3dGltb3lwbmVrdm1hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTU3OTE4OSwiZXhwIjoyMDcxMTU1MTg5fQ.oESHG3g3UJTfR1gL8Hv-s7SqZtZHx_Gd6kfTEyUc1p0", "X-Scheduled-Backup": "true"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);