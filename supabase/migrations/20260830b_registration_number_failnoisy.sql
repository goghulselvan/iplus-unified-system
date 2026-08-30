-- ============================================================================
-- Registration-number: fail loud + durable failure log + ops email  — 2026-08-30
-- Follow-up to 20260830_registration_number_hardening.sql.
--
--   1. registration_number_failures — one row per assignment failure, so nothing
--      is ever only a Postgres WARNING nobody reads.
--   2. trg_auto_assign_reg_number rewritten:
--        - transient contention codes (40P01/40001/55P03/57014) -> log, do NOT
--          re-raise (row saves, the */5 sweeper heals it).
--        - anything else (unknown olympiad, non-numeric class, no district match,
--          duplicate number, ...) -> log AND re-raise, so bad data fails the
--          student-add loudly instead of silently saving without a number.
--        - the failure-log INSERT is itself wrapped so it can never abort the
--          enrolment insert.
--   3. reg-number-auto-retry sweeper also stamps resolved_at on healed rows.
--   4. reg-number-alert cron (*/30) -> edge function reg-number-alert -> emails
--      ragulselvan@iplusedu.in + goghulselvan@gmail.com whenever an unresolved
--      failure or a >15-minute backlog exists. Silent when clean.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable failure log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_number_failures (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id uuid NOT NULL,
  student_id    uuid,
  project_id    uuid,
  school_id     uuid,
  sqlstate      text,
  err_message   text,
  recoverable   boolean NOT NULL,
  failed_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_regnum_failures_open
  ON public.registration_number_failures (failed_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE public.registration_number_failures ENABLE ROW LEVEL SECURITY;
-- No policy: readable only by postgres / service_role (internal ops table).

-- ---------------------------------------------------------------------------
-- 2. Fail-loud trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_assign_reg_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sqlstate    text;
  v_msg         text;
  v_recoverable boolean;
BEGIN
  IF NEW.submitted_at IS NOT NULL AND NEW.registration_number IS NULL THEN
    BEGIN
      PERFORM assign_registration_number(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
      v_msg      := SQLERRM;
      -- transient lock/serialisation contention: let the row save; the sweeper heals it
      v_recoverable := v_sqlstate IN ('40P01', '40001', '55P03', '57014');

      -- best-effort durable record — must never abort the enrolment insert
      BEGIN
        INSERT INTO registration_number_failures
          (enrollment_id, student_id, project_id, school_id, sqlstate, err_message, recoverable)
        VALUES
          (NEW.id, NEW.student_id, NEW.project_id, NEW.school_id, v_sqlstate, v_msg, v_recoverable);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      IF v_recoverable THEN
        RAISE WARNING 'assign_registration_number transient failure for enrollment % — logged, sweeper will retry: % (%)',
          NEW.id, v_msg, v_sqlstate;
      ELSE
        -- bad data / logic error: fail the insert so nothing silently saves without a number
        RAISE EXCEPTION 'Could not assign a registration number: %', v_msg USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Sweeper: retry + stamp resolved_at on healed rows
-- ---------------------------------------------------------------------------
SELECT cron.schedule('reg-number-auto-retry', '*/5 * * * *', $CRON$
  SET LOCAL statement_timeout = '240s';
  SELECT public.retry_registration_numbers(ARRAY(
    SELECT e.id
    FROM public.portal_student_enrollments e
    JOIN public.olympiad_projects p ON p.id = e.project_id
    WHERE p.is_active
      AND (e.registration_number IS NULL OR e.registration_number = '')
    ORDER BY e.created_at
    LIMIT 500
  ));
  UPDATE public.registration_number_failures f
  SET resolved_at = now()
  WHERE f.resolved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.portal_student_enrollments e
      WHERE e.id = f.enrollment_id
        AND e.registration_number IS NOT NULL AND e.registration_number <> ''
    );
$CRON$);

-- ---------------------------------------------------------------------------
-- 4. Ops email cron (key pulled from an existing job, not hard-coded here)
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE v_anon text;
BEGIN
  SELECT substring(command FROM 'Bearer ([A-Za-z0-9._-]+)')
    INTO v_anon
  FROM cron.job
  WHERE command LIKE '%functions/v1/%' AND command ~ 'Bearer [A-Za-z0-9._-]+'
  LIMIT 1;

  IF v_anon IS NULL THEN
    RAISE EXCEPTION 'could not derive anon key from an existing cron job';
  END IF;

  PERFORM cron.schedule('reg-number-alert', '*/30 * * * *', format($cmd$
    SELECT net.http_post(
      url     := 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/reg-number-alert',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
      body    := '{}'::jsonb
    );
  $cmd$, v_anon));
END $mig$;

COMMIT;
