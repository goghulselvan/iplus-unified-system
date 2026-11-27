-- Test for supabase/migrations/20261129_results_manual_upload.sql.
-- Run after that migration is applied:
--   supabase db query --linked -f supabase/tests/results_manual_upload.sql
-- One transaction, rolled back: nothing is left behind. Success ends with 'ALL PASS'.
BEGIN;

DO $fx$
DECLARE
  v_proj constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_school uuid; v_class text; v_oly text;
  v_e uuid[]; v_r text[]; v_r3 text; v_mgr uuid;
BEGIN
  SELECT pe.school_id, st.class_code, pe.olympiad_code INTO v_school, v_class, v_oly
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND st.class_code IN ('14','15','01','02') AND pe.registration_number IS NOT NULL
     AND (SELECT count(DISTINCT es.slot_template_id) FROM exam_slots es
           WHERE es.school_id = pe.school_id AND es.project_id = v_proj AND es.slot_template_id IS NOT NULL) = 1
   GROUP BY 1, 2, 3 HAVING count(*) >= 3 ORDER BY count(*) DESC, 1, 2, 3 LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no school with 3 LKG-Class 2 students of one olympiad and one slot'; END IF;
  SELECT array_agg(x.id ORDER BY x.reg), array_agg(public.results_digits(x.reg) ORDER BY x.reg) INTO v_e, v_r
    FROM (SELECT pe.id, pe.registration_number reg FROM portal_student_enrollments pe
            JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_school AND st.class_code = v_class
             AND pe.olympiad_code = v_oly AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 3) x;
  SELECT public.results_digits(pe.registration_number) INTO v_r3
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND st.class_code = '03' AND pe.registration_number IS NOT NULL
   ORDER BY pe.registration_number LIMIT 1;
  SELECT user_id INTO v_mgr FROM profiles WHERE role::text = 'manager' ORDER BY created_at, user_id LIMIT 1;
  IF v_r3 IS NULL OR v_mgr IS NULL THEN RAISE EXCEPTION 'FIXTURE missing'; END IF;

  PERFORM set_config('test.proj', v_proj::text, true);
  PERFORM set_config('test.class', v_class, true);
  PERFORM set_config('test.oly', v_oly, true);
  PERFORM set_config('test.e1', v_e[1]::text, true);
  PERFORM set_config('test.e2', v_e[2]::text, true);
  PERFORM set_config('test.e3', v_e[3]::text, true);
  PERFORM set_config('test.r1', v_r[1], true);
  PERFORM set_config('test.r2', v_r[2], true);
  PERFORM set_config('test.r3', v_r[3], true);
  PERFORM set_config('test.c3', v_r3, true);
  PERFORM set_config('test.mgr', v_mgr::text, true);
END
$fx$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $t$
DECLARE
  v_proj uuid := current_setting('test.proj')::uuid;
  v_class text := current_setting('test.class');
  v_oly text := current_setting('test.oly');
  v_e1 uuid := current_setting('test.e1')::uuid;
  v_e2 uuid := current_setting('test.e2')::uuid;
  v_e3 uuid := current_setting('test.e3')::uuid;
  v_r1 text := current_setting('test.r1');
  v_r2 text := current_setting('test.r2');
  v_r3 text := current_setting('test.r3');
  v_c3 text := current_setting('test.c3');
  v_nq int; v_q jsonb; v_good jsonb; v_res jsonb; v_kinds text[]; v_paper uuid;
BEGIN
  SELECT question_count INTO v_nq FROM classes WHERE code = v_class;
  -- Per question: Q1 = 0.5, Q2 blank (0), rest 1 -> total nq - 1.5.
  v_q := jsonb_set(jsonb_set((SELECT jsonb_agg('1'::text) FROM generate_series(1, v_nq)), '{0}', '"0.5"'), '{1}', 'null');
  v_good := jsonb_build_array(
    jsonb_build_object('row', 2, 'sheet', 'S1', 'reg', v_r1, 'kind', 'questions', 'values', v_q),
    jsonb_build_object('row', 2, 'sheet', 'S2', 'reg', v_r2, 'kind', 'total', 'total', '12.5'),
    jsonb_build_object('row', 3, 'sheet', 'S2', 'reg', v_r3, 'kind', 'total', 'total', NULL));

  -- 1. Bad file: Class 3 student, bad mark, bad totals -> nothing saved.
  v_res := results_upload_manual(v_proj, 'bad.xlsx', v_good || jsonb_build_array(
    jsonb_build_object('row', 4, 'sheet', 'S2', 'reg', v_c3, 'kind', 'total', 'total', '10'),
    jsonb_build_object('row', 5, 'sheet', 'S2', 'reg', 'REVIEW', 'kind', 'total', 'total', '10'),
    jsonb_build_object('row', 3, 'sheet', 'S1', 'reg', v_r3, 'kind', 'questions', 'values', jsonb_set(v_q, '{3}', '"2"')),
    jsonb_build_object('row', 6, 'sheet', 'S2', 'reg', '999999999999', 'kind', 'total', 'total', '31')), false);
  IF (v_res ->> 'ok')::boolean THEN RAISE EXCEPTION 'bad file accepted: %', v_res; END IF;
  SELECT array_agg(DISTINCT e ->> 'kind' ORDER BY e ->> 'kind') INTO v_kinds FROM jsonb_array_elements(v_res -> 'errors') e;
  IF v_kinds <> ARRAY['bad_mark','not_in_crm','omr_class','unread'] THEN RAISE EXCEPTION 'error kinds: %', v_kinds; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'errors') e WHERE e ->> 'message' LIKE 'Sheet "S1", row 3, Q4: "2" must be 0, 0.5 or 1') THEN
    RAISE EXCEPTION 'bad mark message: %', v_res -> 'errors';
  END IF;
  IF EXISTS (SELECT 1 FROM result_evaluations WHERE enrollment_id IN (v_e1, v_e2, v_e3)) THEN RAISE EXCEPTION 'bad file saved data'; END IF;

  v_res := results_upload_manual(v_proj, 'bad2.csv', jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', v_r1, 'kind', 'total', 'total', '12.3'),
    jsonb_build_object('row', 3, 'reg', v_r2, 'kind', 'total', 'total', (v_nq + 1)::text)), true);
  IF (SELECT count(*) FROM jsonb_array_elements(v_res -> 'errors') e WHERE e ->> 'kind' = 'bad_total') <> 2 THEN
    RAISE EXCEPTION 'bad totals: %', v_res;
  END IF;

  -- 2. Dry run: 2 students, 1 blank row skipped.
  v_res := results_upload_manual(v_proj, 'good.xlsx', v_good, true);
  IF (v_res ->> 'count')::int <> 2 OR jsonb_array_length(v_res -> 'skipped') <> 1 THEN RAISE EXCEPTION 'dry run: %', v_res; END IF;

  -- 3. Save: marked straight away (no key needed), blank row stays Pending.
  v_res := results_upload_manual(v_proj, 'good.xlsx', v_good, false);
  IF (v_res ->> 'saved')::int <> 2 THEN RAISE EXCEPTION 'save: %', v_res; END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> v_nq - 1.5 THEN
    RAISE EXCEPTION 'per-question total: %', (SELECT total FROM result_scores WHERE enrollment_id = v_e1);
  END IF;
  IF (SELECT marks[2] FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL) <> 0 THEN RAISE EXCEPTION 'blank cell not 0'; END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e2) <> 12.5 THEN RAISE EXCEPTION 'totals-only score'; END IF;
  IF (SELECT total_marks FROM result_evaluations WHERE enrollment_id = v_e2 AND deleted_at IS NULL) <> 12.5 THEN RAISE EXCEPTION 'total not stored'; END IF;
  IF EXISTS (SELECT 1 FROM result_evaluations WHERE enrollment_id = v_e3) THEN RAISE EXCEPTION 'blank row was saved'; END IF;
  IF (SELECT rank_school FROM result_scores WHERE enrollment_id = v_e1) <> 1 THEN RAISE EXCEPTION 'ranks'; END IF;
  SELECT paper_id INTO v_paper FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL;

  -- 4. Typed on the student page: total, per question, absent.
  PERFORM results_manual_entry(v_e3, 'total', 20, NULL);
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e3) <> 20 THEN RAISE EXCEPTION 'entry total'; END IF;
  PERFORM results_manual_entry(v_e3, 'questions', NULL, (SELECT array_agg(CASE WHEN n = 1 THEN NULL ELSE 0.5 END) FROM generate_series(1, v_nq) n));
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e3) <> (v_nq - 1) * 0.5 THEN RAISE EXCEPTION 'entry per question'; END IF;
  PERFORM results_manual_entry(v_e3, 'absent', NULL, NULL);
  IF EXISTS (SELECT 1 FROM result_scores WHERE enrollment_id = v_e3)
     OR (SELECT status FROM result_evaluations WHERE enrollment_id = v_e3 AND deleted_at IS NULL) <> 'absent' THEN
    RAISE EXCEPTION 'entry absent';
  END IF;
  BEGIN
    PERFORM results_manual_entry(v_e3, 'total', v_nq + 1, NULL);
    RAISE EXCEPTION 'total above the question count accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'The total must be a number from 0 to %' THEN RAISE; END IF;
  END;

  -- 5. Re-upload replaces.
  v_res := results_upload_manual(v_proj, 'good.xlsx', v_good, false);
  IF (v_res ->> 'replaced')::int <> 2 THEN RAISE EXCEPTION 're-upload: %', v_res; END IF;
END
$t$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
