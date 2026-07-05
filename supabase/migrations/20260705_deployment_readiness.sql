-- Deployment readiness: indexes + RLS policy gaps identified in pre-deploy audit

-- 1. student_registrations: add indexes on the two primary filter columns.
--    Without these, every portal/CRM student query does a full table scan at 5M+ rows.
CREATE INDEX IF NOT EXISTS idx_sr_school_id   ON public.student_registrations (school_id);
CREATE INDEX IF NOT EXISTS idx_sr_project_id  ON public.student_registrations (project_id);
CREATE INDEX IF NOT EXISTS idx_sr_school_proj ON public.student_registrations (school_id, project_id);

-- 2. school_portal_accounts: CRM staff need UPDATE to link schools.
--    The existing policy only allows SELECT for portal users and ALL for superadmins.
--    Non-superadmin CRM staff linking a school via the Link Schools page silently failed.
CREATE POLICY "crm_update_spa"
  ON public.school_portal_accounts
  FOR UPDATE
  TO authenticated
  USING (is_crm_user());
