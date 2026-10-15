-- 2026-10-15 — "Interested for next year" button in the prospect popup (Goghul).
-- Queues a prospect (CRM school or not) as an already-linked Interest Lead for the year after the
-- active project. Does not touch the current project. Idempotent per (year, email).
CREATE OR REPLACE FUNCTION public.mark_interested_next_year(p_prospect_school_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p record;
  s record;
  v_year int;
  v_email text;
  v_id bigint;
BEGIN
  IF NOT public.is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO p FROM prospect_schools WHERE id = p_prospect_school_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'School not found'; END IF;
  SELECT * INTO s FROM schools WHERE prospect_school_id = p.id LIMIT 1;
  SELECT COALESCE(max(project_year) FILTER (WHERE is_active), max(project_year), extract(year FROM now())::int) + 1
    INTO v_year FROM olympiad_projects;
  v_email := COALESCE(NULLIF(trim(s.email), ''), NULLIF(trim(p.email), ''), 'ss' || p.ss_no || '@no-email.invalid');

  INSERT INTO olympiad_interest (for_year, school_name, state, district, school_email, school_mobile,
    contact_name, contact_phone, prospect_school_id, school_id, source, note)
  VALUES (v_year, COALESCE(s.school_name, p.school_name), COALESCE(s.state, p.state), COALESCE(s.district, p.district),
    v_email, COALESCE(NULLIF(s.mobile1, ''), p.mobile), COALESCE(s.contact_person_name, p.principal_name),
    COALESCE(NULLIF(s.mobile1, ''), p.mobile), p.id, s.id, 'marked_by_staff',
    COALESCE(NULLIF(trim(p_note), ''), 'Marked interested for ' || v_year || ' by staff'))
  ON CONFLICT (for_year, lower(school_email)) DO UPDATE SET
    prospect_school_id = COALESCE(olympiad_interest.prospect_school_id, EXCLUDED.prospect_school_id),
    school_id = COALESCE(olympiad_interest.school_id, EXCLUDED.school_id),
    note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (auth.uid(), 'MARKED_INTERESTED_NEXT_YEAR', 'prospect_schools', p.id, NULL,
          jsonb_build_object('for_year', v_year, 'interest_id', v_id));
  RETURN jsonb_build_object('for_year', v_year, 'interest_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_interested_next_year(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_interested_next_year(uuid, text) TO authenticated;
