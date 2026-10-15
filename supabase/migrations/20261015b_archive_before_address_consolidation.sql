-- Permanent archive copies taken before the address consolidation / prospect sync (2026-10-15).
-- RLS on, no policies: readable only by service role. Never dropped.
CREATE TABLE IF NOT EXISTS public.archive_schools_20261015 AS SELECT now() AS archived_at, s.* FROM public.schools s;
CREATE TABLE IF NOT EXISTS public.archive_prospect_schools_20261015 AS SELECT now() AS archived_at, p.* FROM public.prospect_schools p;
CREATE TABLE IF NOT EXISTS public.archive_school_portal_registrations_20261015 AS SELECT now() AS archived_at, r.* FROM public.school_portal_registrations r;
CREATE TABLE IF NOT EXISTS public.archive_school_portal_accounts_20261015 AS SELECT now() AS archived_at, a.* FROM public.school_portal_accounts a;
ALTER TABLE public.archive_schools_20261015 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_prospect_schools_20261015 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_school_portal_registrations_20261015 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_school_portal_accounts_20261015 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.archive_schools_20261015, public.archive_prospect_schools_20261015,
  public.archive_school_portal_registrations_20261015, public.archive_school_portal_accounts_20261015 FROM anon, authenticated;
