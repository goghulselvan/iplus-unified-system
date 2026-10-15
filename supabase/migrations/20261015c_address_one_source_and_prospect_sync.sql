-- 2026-10-15 — One address (address1/address2) + CRM → prospect sync.
-- Goghul: Address 1/2 is the only address; the old schools.school_address is kept only as an
-- automatic copy until every reader is switched, then dropped. CRM details win over prospect.
-- Archive of every old value: archive_schools_20261015 / archive_prospect_schools_20261015.

-- 1. Backfill: Address 1 empty but old field filled → move it into Address 1 (110 schools).
UPDATE public.schools
SET address1 = school_address
WHERE NULLIF(trim(address1), '') IS NULL AND NULLIF(trim(school_address), '') IS NOT NULL;

-- 2. Keep the old field a mirror of Address 1/2 (BEFORE trigger).
--    Old writers that still fill only school_address (portal registration, bulk import, the
--    pre-upload CRM form) have their value moved into Address 1 instead of being lost.
CREATE OR REPLACE FUNCTION public.trg_fn_schools_address_mirror()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(trim(NEW.address1), '') IS NULL AND NULLIF(trim(NEW.school_address), '') IS NOT NULL THEN
      NEW.address1 := NEW.school_address;
    END IF;
  ELSIF NEW.school_address IS DISTINCT FROM OLD.school_address
        AND NEW.address1 IS NOT DISTINCT FROM OLD.address1
        AND NEW.address2 IS NOT DISTINCT FROM OLD.address2
        AND NULLIF(trim(NEW.school_address), '') IS NOT NULL THEN
    -- an old-style edit of the old field only → treat it as the new Address 1
    NEW.address1 := NEW.school_address;
  END IF;
  NEW.school_address := COALESCE(NULLIF(concat_ws(', ', NULLIF(trim(NEW.address1), ''), NULLIF(trim(NEW.address2), '')), ''), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schools_address_mirror ON public.schools;
CREATE TRIGGER trg_schools_address_mirror
BEFORE INSERT OR UPDATE ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_schools_address_mirror();

-- Re-mirror every row once so the old field matches Address 1/2 everywhere (22 differed).
UPDATE public.schools SET school_address = school_address;

-- 3a. Log of every prospect field overwritten by the sync (old + new). Own table so a
--     system write with no logged-in user (portal registration, bulk jobs) never fails.
CREATE TABLE IF NOT EXISTS public.prospect_sync_log (
  id bigserial PRIMARY KEY,
  prospect_school_id uuid NOT NULL,
  school_id uuid NOT NULL,
  changed_by uuid,
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_sync_log_prospect_idx ON public.prospect_sync_log (prospect_school_id, created_at DESC);
ALTER TABLE public.prospect_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospect_sync_log_crm_read ON public.prospect_sync_log;
CREATE POLICY prospect_sync_log_crm_read ON public.prospect_sync_log FOR SELECT TO authenticated USING (is_crm_user());
REVOKE ALL ON public.prospect_sync_log FROM anon;

-- 3. CRM → prospect sync (AFTER trigger). CRM wins; an empty CRM value never erases a
--    filled prospect value. Every change is written to prospect_sync_log with old/new.
CREATE OR REPLACE FUNCTION public.sync_prospect_from_school(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  p record;
  v_addr text;
  v_new jsonb := '{}'::jsonb;
  v_old jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO s FROM schools WHERE id = p_school_id;
  IF s.id IS NULL OR s.prospect_school_id IS NULL THEN RETURN; END IF;
  SELECT * INTO p FROM prospect_schools WHERE id = s.prospect_school_id FOR UPDATE;
  IF p.id IS NULL THEN RETURN; END IF;

  v_addr := NULLIF(concat_ws(', ', NULLIF(trim(s.address1), ''), NULLIF(trim(s.address2), '')), '');

  IF NULLIF(trim(s.school_name), '') IS NOT NULL AND s.school_name IS DISTINCT FROM p.school_name THEN
    v_old := v_old || jsonb_build_object('school_name', p.school_name); v_new := v_new || jsonb_build_object('school_name', s.school_name); END IF;
  IF v_addr IS NOT NULL AND v_addr IS DISTINCT FROM p.address THEN
    v_old := v_old || jsonb_build_object('address', p.address); v_new := v_new || jsonb_build_object('address', v_addr); END IF;
  IF NULLIF(trim(s.district), '') IS NOT NULL AND s.district IS DISTINCT FROM p.district THEN
    v_old := v_old || jsonb_build_object('district', p.district); v_new := v_new || jsonb_build_object('district', s.district); END IF;
  IF NULLIF(trim(s.state), '') IS NOT NULL AND s.state IS DISTINCT FROM p.state THEN
    v_old := v_old || jsonb_build_object('state', p.state); v_new := v_new || jsonb_build_object('state', s.state); END IF;
  IF NULLIF(trim(s.pincode), '') IS NOT NULL AND s.pincode IS DISTINCT FROM p.pincode THEN
    v_old := v_old || jsonb_build_object('pincode', p.pincode); v_new := v_new || jsonb_build_object('pincode', s.pincode); END IF;
  IF NULLIF(trim(s.board), '') IS NOT NULL AND s.board IS DISTINCT FROM p.board THEN
    v_old := v_old || jsonb_build_object('board', p.board); v_new := v_new || jsonb_build_object('board', s.board); END IF;
  IF NULLIF(trim(s.email), '') IS NOT NULL AND s.email IS DISTINCT FROM p.email THEN
    v_old := v_old || jsonb_build_object('email', p.email); v_new := v_new || jsonb_build_object('email', s.email); END IF;
  IF NULLIF(trim(s.principal_name), '') IS NOT NULL AND s.principal_name IS DISTINCT FROM p.principal_name THEN
    v_old := v_old || jsonb_build_object('principal_name', p.principal_name); v_new := v_new || jsonb_build_object('principal_name', s.principal_name); END IF;

  IF v_new = '{}'::jsonb THEN RETURN; END IF;

  UPDATE prospect_schools SET
    school_name    = COALESCE(v_new->>'school_name', school_name),
    address        = COALESCE(v_new->>'address', address),
    district       = COALESCE(v_new->>'district', district),
    state          = COALESCE(v_new->>'state', state),
    pincode        = COALESCE(v_new->>'pincode', pincode),
    board          = COALESCE(v_new->>'board', board),
    email          = COALESCE(v_new->>'email', email),
    principal_name = COALESCE(v_new->>'principal_name', principal_name),
    updated_at     = now()
  WHERE id = p.id;

  INSERT INTO prospect_sync_log (prospect_school_id, school_id, changed_by, old_values, new_values)
  VALUES (p.id, s.id, auth.uid(), v_old, v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_prospect_from_school(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.trg_fn_schools_sync_prospect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.school_name    IS DISTINCT FROM OLD.school_name
     OR NEW.address1       IS DISTINCT FROM OLD.address1
     OR NEW.address2       IS DISTINCT FROM OLD.address2
     OR NEW.district       IS DISTINCT FROM OLD.district
     OR NEW.state          IS DISTINCT FROM OLD.state
     OR NEW.pincode        IS DISTINCT FROM OLD.pincode
     OR NEW.board          IS DISTINCT FROM OLD.board
     OR NEW.email          IS DISTINCT FROM OLD.email
     OR NEW.principal_name IS DISTINCT FROM OLD.principal_name
     OR NEW.prospect_school_id IS DISTINCT FROM OLD.prospect_school_id THEN
    PERFORM sync_prospect_from_school(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_schools_sync_prospect ON public.schools;
CREATE TRIGGER trg_schools_sync_prospect
AFTER INSERT OR UPDATE ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_schools_sync_prospect();

-- 4. One-time clean-up: push every CRM school's details to its prospect row.
SELECT public.sync_prospect_from_school(id) FROM public.schools;
