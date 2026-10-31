-- ============================================================================
-- Let anonymous portal visitors read the active olympiad project   2026-09-01
--
-- olympiad_projects has RLS on with only {authenticated} SELECT policies
-- (ref_select). The public portal Register page went dynamic in 79a746e and
-- now reads olympiad_projects (project_year, project_name, registration_deadline)
-- to decide whether to show the registration form or the off-season "register
-- interest" form. An unauthenticated visitor runs as `anon`, gets zero rows,
-- so the page ALWAYS falls back to "registration closed" no matter the
-- deadline. Add a narrow anon SELECT policy for the active project only.
--
-- Every column is public-facing (name, year, deadline, brochure/consent URLs);
-- nothing sensitive is exposed.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS anon_select_active_olympiad_project ON public.olympiad_projects;
CREATE POLICY anon_select_active_olympiad_project
  ON public.olympiad_projects
  FOR SELECT
  TO anon
  USING (is_active = true);

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901b', 'anon_read_active_olympiad_project')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- verification: what anon can now see
SET LOCAL ROLE anon;
SELECT project_name, project_year, registration_deadline::text AS deadline,
       (now() < registration_deadline) AS is_open_now
FROM public.olympiad_projects;
RESET ROLE;
