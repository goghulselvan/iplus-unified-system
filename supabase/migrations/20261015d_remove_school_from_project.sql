-- 2026-10-15 — "Remove from this project" (Goghul, option b).
-- A school that registered / showed interest but is not participating is taken out of the project
-- WITHOUT deleting the school: its own portal details fill any EMPTY CRM field (CRM is final), the
-- portal registration is archived then deleted, the portal login is DISABLED (never deleted —
-- restorable), the project workflow row goes, communications / follow-ups / calls stay, and by
-- default it is queued in Interest Leads for the next year. Blocked when the school has students,
-- payments, orders or results.

CREATE TABLE IF NOT EXISTS public.school_removal_archive (
  id bigserial PRIMARY KEY,
  school_id uuid NOT NULL,
  ss_no integer,
  project_id uuid NOT NULL,
  removed_by uuid,
  reason text NOT NULL CHECK (reason IN ('next_year', 'not_interested')),
  filled_from_portal jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow jsonb,
  portal_registrations jsonb,
  portal_accounts jsonb,
  exam_rows jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.school_removal_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_removal_archive_crm_read ON public.school_removal_archive;
CREATE POLICY school_removal_archive_crm_read ON public.school_removal_archive FOR SELECT TO authenticated USING (is_crm_user());
REVOKE ALL ON public.school_removal_archive FROM anon;

-- What stops a removal (the dialog uses it to explain the block). Empty object = can remove.
CREATE OR REPLACE FUNCTION public.school_removal_blockers(p_school_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'students',        NULLIF((SELECT count(*) FROM portal_registered_students WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'enrolments',      NULLIF((SELECT count(*) FROM portal_student_enrollments WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'payments',        NULLIF((SELECT count(*) FROM payment_transactions WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'payment_proofs',  NULLIF((SELECT count(*) FROM payment_proofs WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'portal_payments', NULLIF((SELECT count(*) FROM portal_payment_submissions WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'book_orders',     NULLIF((SELECT count(*) FROM product_orders WHERE school_id = p_school_id), 0),
    'invoices',        NULLIF((SELECT count(*) FROM invoices WHERE school_id = p_school_id), 0),
    'results',         NULLIF((SELECT count(*) FROM result_students WHERE school_id = p_school_id AND project_id = p_project_id), 0)
  ))
$$;

CREATE OR REPLACE FUNCTION public.remove_school_from_project(
  p_school_id uuid, p_project_id uuid, p_reason text DEFAULT 'next_year')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  r record;
  v_proj record;
  v_block jsonb;
  v_filled jsonb := '{}'::jsonb;
  v_email text;
  v_interest_id bigint;
  v_archive_id bigint;
  v_disabled int;
BEGIN
  IF NOT public.is_crm_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_reason NOT IN ('next_year', 'not_interested') THEN RAISE EXCEPTION 'Reason must be next_year or not_interested'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('remove_school_' || p_school_id::text));
  SELECT * INTO s FROM schools WHERE id = p_school_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'School not found'; END IF;
  SELECT * INTO v_proj FROM olympiad_projects WHERE id = p_project_id;
  IF v_proj.id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;

  v_block := school_removal_blockers(p_school_id, p_project_id);
  IF v_block <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Cannot remove: this school has % in this project', v_block USING ERRCODE = 'P0002';
  END IF;

  -- 1. The school's own portal details fill EMPTY CRM fields only (latest registration first).
  FOR r IN SELECT * FROM school_portal_registrations WHERE matched_school_id = p_school_id ORDER BY created_at DESC LOOP
    UPDATE schools x SET
      address1 = COALESCE(NULLIF(trim(x.address1), ''), NULLIF(trim(r.address1), '')),
      address2 = COALESCE(NULLIF(trim(x.address2), ''), NULLIF(trim(r.address2), '')),
      state = COALESCE(NULLIF(trim(x.state), ''), NULLIF(trim(r.state), '')),
      district = COALESCE(NULLIF(trim(x.district), ''), NULLIF(trim(r.district), ''), x.district),
      pincode = COALESCE(NULLIF(trim(x.pincode), ''), NULLIF(trim(r.pincode), '')),
      board = COALESCE(NULLIF(trim(x.board), ''), NULLIF(trim(r.board), '')),
      email = COALESCE(NULLIF(trim(x.email), ''), NULLIF(trim(r.email), '')),
      contact_person_name = COALESCE(NULLIF(trim(x.contact_person_name), ''), NULLIF(trim(r.contact_name), '')),
      mobile1 = COALESCE(NULLIF(trim(x.mobile1), ''), NULLIF(trim(r.phone), '')),
      corr_name = COALESCE(NULLIF(trim(x.corr_name), ''), NULLIF(trim(r.corr_name), '')),
      corr_mobile = COALESCE(NULLIF(trim(x.corr_mobile), ''), NULLIF(trim(r.corr_mobile), '')),
      principal_name = COALESCE(NULLIF(trim(x.principal_name), ''), NULLIF(trim(r.principal_name), '')),
      principal_mobile = COALESCE(NULLIF(trim(x.principal_mobile), ''), NULLIF(trim(r.principal_mobile), '')),
      coord_mobile = COALESCE(NULLIF(trim(x.coord_mobile), ''), NULLIF(trim(r.coord_mobile), '')),
      teacher_epo = COALESCE(NULLIF(trim(x.teacher_epo), ''), NULLIF(trim(r.teacher_epo), '')),
      teacher_epo_mob = COALESCE(NULLIF(trim(x.teacher_epo_mob), ''), NULLIF(trim(r.teacher_epo_mob), '')),
      teacher_mpo = COALESCE(NULLIF(trim(x.teacher_mpo), ''), NULLIF(trim(r.teacher_mpo), '')),
      teacher_mpo_mob = COALESCE(NULLIF(trim(x.teacher_mpo_mob), ''), NULLIF(trim(r.teacher_mpo_mob), '')),
      teacher_spo = COALESCE(NULLIF(trim(x.teacher_spo), ''), NULLIF(trim(r.teacher_spo), '')),
      teacher_spo_mob = COALESCE(NULLIF(trim(x.teacher_spo_mob), ''), NULLIF(trim(r.teacher_spo_mob), '')),
      teacher_gksspo = COALESCE(NULLIF(trim(x.teacher_gksspo), ''), NULLIF(trim(r.teacher_gksspo), '')),
      teacher_gksspo_mob = COALESCE(NULLIF(trim(x.teacher_gksspo_mob), ''), NULLIF(trim(r.teacher_gksspo_mob), '')),
      teacher_lrpo = COALESCE(NULLIF(trim(x.teacher_lrpo), ''), NULLIF(trim(r.teacher_lrpo), '')),
      teacher_lrpo_mob = COALESCE(NULLIF(trim(x.teacher_lrpo_mob), ''), NULLIF(trim(r.teacher_lrpo_mob), '')),
      teacher_kidspo = COALESCE(NULLIF(trim(x.teacher_kidspo), ''), NULLIF(trim(r.teacher_kidspo), '')),
      teacher_kidspo_mob = COALESCE(NULLIF(trim(x.teacher_kidspo_mob), ''), NULLIF(trim(r.teacher_kidspo_mob), ''))
    WHERE x.id = p_school_id;
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(n.k, n.v), '{}'::jsonb) INTO v_filled
  FROM jsonb_each(to_jsonb((SELECT x FROM schools x WHERE x.id = p_school_id))) n(k, v)
  WHERE n.v IS DISTINCT FROM to_jsonb(s) -> n.k AND n.k NOT IN ('updated_at', 'school_address');

  -- 2. Archive everything that is about to change.
  INSERT INTO school_removal_archive (school_id, ss_no, project_id, removed_by, reason, filled_from_portal,
    workflow, portal_registrations, portal_accounts, exam_rows)
  VALUES (p_school_id, s.ss_no, p_project_id, auth.uid(), p_reason, v_filled,
    (SELECT to_jsonb(w) FROM school_project_workflow w WHERE w.school_id = p_school_id AND w.project_id = p_project_id),
    (SELECT jsonb_agg(to_jsonb(x)) FROM school_portal_registrations x WHERE x.matched_school_id = p_school_id),
    (SELECT jsonb_agg(to_jsonb(x)) FROM school_portal_accounts x WHERE x.school_id = p_school_id),
    jsonb_build_object(
      'exam_slots', (SELECT jsonb_agg(to_jsonb(x)) FROM exam_slots x WHERE x.school_id = p_school_id AND x.project_id = p_project_id),
      'exam_schedules', (SELECT jsonb_agg(to_jsonb(x)) FROM exam_schedules x WHERE x.school_id = p_school_id AND x.project_id = p_project_id)))
  RETURNING id INTO v_archive_id;

  -- 3. Portal registration deleted, portal login DISABLED (kept, restorable), this project's
  --    workflow / exam rows removed. Communications, follow-ups, calls, activity logs stay.
  DELETE FROM school_portal_registrations WHERE matched_school_id = p_school_id;
  UPDATE school_portal_accounts SET is_active = false WHERE school_id = p_school_id;
  GET DIAGNOSTICS v_disabled = ROW_COUNT;
  DELETE FROM exam_slots WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM exam_schedules WHERE school_id = p_school_id AND project_id = p_project_id;
  DELETE FROM school_project_workflow WHERE school_id = p_school_id AND project_id = p_project_id;

  UPDATE schools SET
    current_project_id = CASE WHEN current_project_id = p_project_id THEN NULL ELSE current_project_id END,
    registration_status = 'Pending', registration_interest = NULL, contacted = 'No', portal_registered = false
  WHERE id = p_school_id;

  -- 4. Next-year interest lead, already linked (shows as Linked in Interest Leads).
  IF p_reason = 'next_year' THEN
    SELECT email INTO v_email FROM schools WHERE id = p_school_id;
    v_email := COALESCE(NULLIF(trim(v_email), ''), 'ss' || s.ss_no || '@no-email.invalid');
    INSERT INTO olympiad_interest (for_year, school_name, state, district, school_email, school_mobile,
      contact_name, contact_phone, prospect_school_id, school_id, source, note)
    SELECT v_proj.project_year + 1, x.school_name, x.state, x.district, v_email, x.mobile1,
      x.contact_person_name, x.mobile1, x.prospect_school_id, x.id, 'removed_from_project',
      'Removed from ' || v_proj.project_year || ' — interested for next year'
    FROM schools x WHERE x.id = p_school_id
    ON CONFLICT (for_year, lower(school_email)) DO UPDATE SET
      prospect_school_id = COALESCE(olympiad_interest.prospect_school_id, EXCLUDED.prospect_school_id),
      school_id = COALESCE(olympiad_interest.school_id, EXCLUDED.school_id),
      note = EXCLUDED.note, updated_at = now()
    RETURNING id INTO v_interest_id;
    UPDATE prospect_schools SET stage = 'interested' WHERE id = s.prospect_school_id;
  ELSE
    UPDATE prospect_schools SET stage = 'contacted' WHERE id = s.prospect_school_id;
  END IF;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (auth.uid(), 'SCHOOL_REMOVED_FROM_PROJECT', 'schools', p_school_id,
    jsonb_build_object('project_id', p_project_id, 'archive_id', v_archive_id),
    jsonb_build_object('reason', p_reason, 'interest_id', v_interest_id, 'filled_from_portal', v_filled,
                       'logins_disabled', v_disabled));

  RETURN jsonb_build_object('archive_id', v_archive_id, 'interest_id', v_interest_id,
    'filled_from_portal', v_filled, 'logins_disabled', v_disabled);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_school_from_project(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_school_from_project(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.school_removal_blockers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_removal_blockers(uuid, uuid) TO authenticated;
