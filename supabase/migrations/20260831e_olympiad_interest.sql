-- ============================================================================
-- Off-season "register your interest" for next year's Olympiad  — 2026-08-31
--
-- When the active project's registration_deadline has passed, the public
-- Register page shows an interest form for project_year + 1 instead of the
-- (closed) registration form. Leads land in olympiad_interest, keyed by
-- for_year (an int — never a project id/name, since project names are editable).
--
-- Staff link each lead to a prospect_schools row (match or create). When next
-- year's project exists, "Import interested schools" seeds the CRM pipeline:
-- a school_project_workflow row with registration_interest = 'Interested', so
-- the existing workflow starts for that school. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.olympiad_interest (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  for_year          integer NOT NULL,
  school_name       text NOT NULL,
  state             text,
  district          text,
  school_email      text NOT NULL,
  school_mobile     text,
  contact_name      text,
  contact_phone     text,
  prospect_school_id uuid REFERENCES public.prospect_schools(id) ON DELETE SET NULL,
  school_id         uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  converted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_olympiad_interest_year_email
  ON public.olympiad_interest (for_year, lower(school_email));
CREATE INDEX IF NOT EXISTS idx_olympiad_interest_open
  ON public.olympiad_interest (for_year) WHERE converted_at IS NULL;

ALTER TABLE public.olympiad_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS olympiad_interest_staff_select ON public.olympiad_interest;
CREATE POLICY olympiad_interest_staff_select ON public.olympiad_interest
  FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS olympiad_interest_staff_update ON public.olympiad_interest;
CREATE POLICY olympiad_interest_staff_update ON public.olympiad_interest
  FOR UPDATE USING (is_crm_user());
-- No anon/insert policy: submissions go only through submit_olympiad_interest().

-- ---------------------------------------------------------------------------
-- Public submit (anon). Honeypot: any non-empty p_hp -> pretend-success no-op.
-- Upsert on (for_year, lower(email)) so a repeat submission updates, not dupes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_olympiad_interest(
  p_for_year      integer,
  p_school_name   text,
  p_state         text,
  p_district      text,
  p_school_email  text,
  p_school_mobile text,
  p_contact_name  text,
  p_contact_phone text,
  p_hp            text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_school_email, '')));
BEGIN
  IF p_hp IS NOT NULL AND btrim(p_hp) <> '' THEN
    RETURN;  -- bot
  END IF;
  IF p_for_year IS NULL OR p_for_year < 2025 OR p_for_year > 2100 THEN
    RAISE EXCEPTION 'Invalid year';
  END IF;
  IF btrim(COALESCE(p_school_name, '')) = '' THEN
    RAISE EXCEPTION 'School name is required';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid school email is required';
  END IF;

  INSERT INTO olympiad_interest
    (for_year, school_name, state, district, school_email, school_mobile, contact_name, contact_phone)
  VALUES
    (p_for_year, btrim(p_school_name), NULLIF(btrim(COALESCE(p_state,'')),''), NULLIF(btrim(COALESCE(p_district,'')),''),
     v_email, NULLIF(btrim(COALESCE(p_school_mobile,'')),''), NULLIF(btrim(COALESCE(p_contact_name,'')),''),
     NULLIF(btrim(COALESCE(p_contact_phone,'')),''))
  ON CONFLICT (for_year, lower(school_email)) DO UPDATE SET
    school_name   = EXCLUDED.school_name,
    state         = EXCLUDED.state,
    district      = EXCLUDED.district,
    school_mobile = EXCLUDED.school_mobile,
    contact_name  = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    updated_at    = now()
  WHERE olympiad_interest.converted_at IS NULL;  -- don't disturb an already-imported lead
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_olympiad_interest(integer,text,text,text,text,text,text,text,text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff: create a prospect_schools row from a lead, link it back
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_prospect_from_interest(p_interest_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead olympiad_interest%ROWTYPE;
  v_pid  uuid;
BEGIN
  IF NOT is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO v_lead FROM olympiad_interest WHERE id = p_interest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interest lead not found'; END IF;
  IF v_lead.prospect_school_id IS NOT NULL THEN
    RETURN v_lead.prospect_school_id;  -- already linked
  END IF;

  -- ss_no omitted on purpose -> the sequence default assigns it.
  -- source must satisfy prospect_schools_source_check (scraped|manual|portal_registration|migration)
  INSERT INTO prospect_schools (school_name, state, district, email, mobile, source, stage, notes)
  VALUES (v_lead.school_name, v_lead.state, v_lead.district, v_lead.school_email, v_lead.school_mobile,
          'portal_registration', 'uncontacted',
          'Created from Olympiad interest form (' || v_lead.for_year || ')')
  RETURNING id INTO v_pid;

  UPDATE olympiad_interest SET prospect_school_id = v_pid, updated_at = now() WHERE id = p_interest_id;
  RETURN v_pid;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_prospect_from_interest(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Staff: link a lead to an existing prospect_schools row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_interest_to_prospect(p_interest_id bigint, p_prospect_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school_id uuid;
BEGIN
  IF NOT is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM prospect_schools WHERE id = p_prospect_school_id) THEN
    RAISE EXCEPTION 'Prospect school not found';
  END IF;
  SELECT id INTO v_school_id FROM schools WHERE prospect_school_id = p_prospect_school_id LIMIT 1;
  UPDATE olympiad_interest
  SET prospect_school_id = p_prospect_school_id, school_id = v_school_id, updated_at = now()
  WHERE id = p_interest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interest lead not found'; END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.link_interest_to_prospect(bigint, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Staff: import matched leads into a project's pipeline. Idempotent.
-- Returns { imported, skipped_not_linked, skipped_already, results:[...] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_interest_leads_to_project(p_interest_ids bigint[], p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id        bigint;
  v_lead      olympiad_interest%ROWTYPE;
  v_ps        prospect_schools%ROWTYPE;
  v_school_id uuid;
  v_imported  int := 0;
  v_not_link  int := 0;
  v_already   int := 0;
  v_results   jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM olympiad_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  IF p_interest_ids IS NULL OR array_length(p_interest_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No leads selected';
  END IF;

  FOREACH v_id IN ARRAY p_interest_ids LOOP
    SELECT * INTO v_lead FROM olympiad_interest WHERE id = v_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_lead.converted_at IS NOT NULL THEN
      v_already := v_already + 1;
      v_results := v_results || jsonb_build_object('id', v_id, 'result', 'already_imported');
      CONTINUE;
    END IF;
    IF v_lead.prospect_school_id IS NULL THEN
      v_not_link := v_not_link + 1;
      v_results := v_results || jsonb_build_object('id', v_id, 'result', 'not_linked');
      CONTINUE;
    END IF;

    -- find or create the CRM schools row for this prospect
    SELECT id INTO v_school_id FROM schools WHERE prospect_school_id = v_lead.prospect_school_id LIMIT 1;
    IF v_school_id IS NULL THEN
      SELECT * INTO v_ps FROM prospect_schools WHERE id = v_lead.prospect_school_id;
      -- schools has NOT-NULL school_address/district/pincode; interest-form
      -- prospects may lack them, and an explicit NULL overrides the '' default.
      INSERT INTO schools (school_name, ss_no, district, state, board, mobile1, email, school_address, pincode, prospect_school_id)
      VALUES (v_ps.school_name, v_ps.ss_no, COALESCE(v_ps.district, ''), v_ps.state, v_ps.board, v_ps.mobile, v_ps.email,
              COALESCE(v_ps.address, ''), COALESCE(v_ps.pincode, ''), v_lead.prospect_school_id)
      RETURNING id INTO v_school_id;
    END IF;

    -- start the workflow for this project (don't clobber an existing row)
    INSERT INTO school_project_workflow (school_id, project_id, registration_status, registration_interest, contacted)
    VALUES (v_school_id, p_project_id, 'Pending', 'Interested', 'Yes')
    ON CONFLICT (school_id, project_id) DO NOTHING;

    UPDATE prospect_schools
    SET stage = 'interested', linked_to_crm = true
    WHERE id = v_lead.prospect_school_id AND COALESCE(stage, 'uncontacted') = 'uncontacted';

    UPDATE olympiad_interest
    SET converted_at = now(), school_id = v_school_id, updated_at = now()
    WHERE id = v_id;

    v_imported := v_imported + 1;
    v_results := v_results || jsonb_build_object('id', v_id, 'result', 'imported', 'school_id', v_school_id);
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped_not_linked', v_not_link,
    'skipped_already', v_already,
    'results', v_results
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.import_interest_leads_to_project(bigint[], uuid) TO authenticated;

COMMIT;
