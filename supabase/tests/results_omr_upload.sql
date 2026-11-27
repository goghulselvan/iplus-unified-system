-- Test for supabase/migrations/20261124_results_omr_upload_first.sql.
-- Run after that migration is applied:
--   supabase db query --linked -f supabase/tests/results_omr_upload.sql
-- Everything happens inside one transaction that is rolled back, so no data is left
-- behind. Any failed assertion raises an exception; success ends with SELECT 'ALL PASS'.
--
-- Fixtures are real: the 2026 project, three enrolments of one Class 3+ olympiad from a
-- school with exactly one exam slot, one LKG-Class 2 enrolment, and a real manager login.
-- Checks run as that manager (role authenticated + request.jwt.claims).
BEGIN;

DO $fx$
DECLARE
  v_proj constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_school uuid; v_class text; v_oly text; v_slot uuid;
  v_e uuid[]; v_r text[];
  v_m uuid; v_mr text;
  v_mgr uuid;
BEGIN
  SELECT pe.school_id, st.class_code, pe.olympiad_code INTO v_school, v_class, v_oly
    FROM portal_student_enrollments pe
    JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND st.class_code NOT IN ('14','15','01','02')
     AND pe.registration_number IS NOT NULL
     AND (SELECT count(DISTINCT es.slot_template_id) FROM exam_slots es
           WHERE es.school_id = pe.school_id AND es.project_id = v_proj AND es.slot_template_id IS NOT NULL) = 1
   GROUP BY 1, 2, 3 HAVING count(*) >= 3
   ORDER BY count(*) DESC, 1, 2, 3 LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no school with 3 Class 3+ students of one olympiad and one slot'; END IF;
  SELECT DISTINCT es.slot_template_id INTO v_slot FROM exam_slots es
   WHERE es.school_id = v_school AND es.project_id = v_proj AND es.slot_template_id IS NOT NULL;

  SELECT array_agg(x.id ORDER BY x.reg), array_agg(public.results_digits(x.reg) ORDER BY x.reg) INTO v_e, v_r
    FROM (SELECT pe.id, pe.registration_number AS reg
            FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_school AND st.class_code = v_class
             AND pe.olympiad_code = v_oly AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 3) x;

  SELECT pe.id, public.results_digits(pe.registration_number) INTO v_m, v_mr
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND st.class_code = '02' AND pe.registration_number IS NOT NULL
   ORDER BY pe.registration_number LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no Class 2 enrolment'; END IF;

  SELECT user_id INTO v_mgr FROM profiles WHERE role::text = 'manager' ORDER BY created_at, user_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no manager profile'; END IF;

  IF EXISTS (SELECT 1 FROM question_papers WHERE project_id = v_proj AND class_code = v_class
               AND olympiad_code = v_oly AND slot_template_id = v_slot AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FIXTURE: a live paper already exists for this group; this test expects none';
  END IF;

  PERFORM set_config('test.proj', v_proj::text, true);
  PERFORM set_config('test.class', v_class, true);
  PERFORM set_config('test.oly', v_oly, true);
  PERFORM set_config('test.slot', v_slot::text, true);
  PERFORM set_config('test.e1', v_e[1]::text, true);
  PERFORM set_config('test.e2', v_e[2]::text, true);
  PERFORM set_config('test.e3', v_e[3]::text, true);
  PERFORM set_config('test.r1', v_r[1], true);
  PERFORM set_config('test.r2', v_r[2], true);
  PERFORM set_config('test.r3', v_r[3], true);
  PERFORM set_config('test.rm', v_mr, true);
  PERFORM set_config('test.mgr', v_mgr::text, true);
END
$fx$;

SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $t$
DECLARE
  v_proj  uuid := current_setting('test.proj')::uuid;
  v_class text := current_setting('test.class');
  v_oly   text := current_setting('test.oly');
  v_slot  uuid := current_setting('test.slot')::uuid;
  v_e1 uuid := current_setting('test.e1')::uuid;
  v_e2 uuid := current_setting('test.e2')::uuid;
  v_e3 uuid := current_setting('test.e3')::uuid;
  v_r1 text := current_setting('test.r1');
  v_r2 text := current_setting('test.r2');
  v_r3 text := current_setting('test.r3');
  v_rm text := current_setting('test.rm');
  v_nq int;
  v_all_a jsonb; v_row1 jsonb; v_good jsonb; v_bad jsonb;
  v_res jsonb; v_kinds text[];
  v_paper uuid; v_n int; v_total numeric;
BEGIN
  SELECT question_count INTO v_nq FROM classes WHERE code = v_class;
  -- 60 columns like the OMR export; only the first v_nq are read.
  v_all_a := (SELECT jsonb_agg('A'::text) FROM generate_series(1, 60));
  -- Student 1: Q1 MULTIPLE, Q2 blank, rest A; lower-case letters are accepted.
  v_row1 := jsonb_set(jsonb_set(jsonb_set(v_all_a, '{0}', '"MULTIPLE"'), '{1}', 'null'), '{2}', '"a"');
  v_good := jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', v_r1, 'values', v_row1),
    jsonb_build_object('row', 3, 'reg', v_r2, 'values', v_all_a),
    jsonb_build_object('row', 4, 'reg', v_r3, 'values', v_all_a));

  -- 1. A bad file: every kind of problem, nothing saved.
  v_bad := v_good || jsonb_build_array(
    jsonb_build_object('row', 5, 'reg', 'REVIEW', 'values', v_all_a),
    jsonb_build_object('row', 6, 'reg', '999999999999', 'values', v_all_a),
    jsonb_build_object('row', 7, 'reg', v_r2, 'values', v_all_a),
    jsonb_build_object('row', 8, 'reg', v_rm, 'values', v_all_a),
    jsonb_build_object('row', 9, 'reg', v_r3, 'values', jsonb_set(v_all_a, '{4}', '"E"')),
    jsonb_build_object('row', 10, 'reg', '12345', 'values', v_all_a));
  v_res := results_upload_omr(v_proj, 'bad.xlsx', v_bad, false);
  IF (v_res ->> 'ok')::boolean THEN RAISE EXCEPTION 'bad file was accepted: %', v_res; END IF;
  SELECT array_agg(DISTINCT e ->> 'kind' ORDER BY e ->> 'kind') INTO v_kinds FROM jsonb_array_elements(v_res -> 'errors') e;
  IF v_kinds <> ARRAY['bad_answer','duplicate','manual_class','not_in_crm','unread'] THEN
    RAISE EXCEPTION 'wrong error kinds: %', v_kinds;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'errors') e
                  WHERE e ->> 'message' = 'Row 5: the roll number was not read by the OMR machine ("REVIEW")') THEN
    RAISE EXCEPTION 'REVIEW message missing: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM result_evaluations WHERE enrollment_id IN (v_e1, v_e2, v_e3))
     OR EXISTS (SELECT 1 FROM question_papers WHERE project_id = v_proj AND class_code = v_class
                  AND olympiad_code = v_oly AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'bad file left data behind';
  END IF;

  -- 2. Dry run of the good file: summary, nothing created.
  v_res := results_upload_omr(v_proj, 'good.xlsx', v_good, true);
  IF NOT (v_res ->> 'ok')::boolean OR (v_res ->> 'count')::int <> 3 THEN RAISE EXCEPTION 'dry run: %', v_res; END IF;
  IF (v_res #>> '{papers,0,paperExists}')::boolean OR (v_res #>> '{papers,0,keyReady}')::boolean
     OR (v_res #>> '{papers,0,count}')::int <> 3 THEN
    RAISE EXCEPTION 'dry run paper summary: %', v_res -> 'papers';
  END IF;
  IF EXISTS (SELECT 1 FROM question_papers WHERE project_id = v_proj AND class_code = v_class
               AND olympiad_code = v_oly AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'dry run created a paper';
  END IF;

  -- 3. Save: empty paper created, answers stored, nobody marked yet.
  v_res := results_upload_omr(v_proj, 'good.xlsx', v_good, false);
  IF (v_res ->> 'saved')::int <> 3 THEN RAISE EXCEPTION 'save: %', v_res; END IF;
  SELECT id INTO v_paper FROM question_papers WHERE project_id = v_proj AND class_code = v_class
     AND olympiad_code = v_oly AND slot_template_id = v_slot AND deleted_at IS NULL;
  IF v_paper IS NULL THEN RAISE EXCEPTION 'paper not created'; END IF;
  IF (SELECT total_questions FROM question_papers WHERE id = v_paper) <> v_nq THEN RAISE EXCEPTION 'paper question count'; END IF;
  IF (SELECT answers[1:3] FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL)
     IS DISTINCT FROM ARRAY['M', NULL, 'A'] THEN
    RAISE EXCEPTION 'stored answers: %', (SELECT answers[1:3] FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL);
  END IF;
  IF (SELECT cardinality(answers) FROM result_evaluations WHERE enrollment_id = v_e2 AND deleted_at IS NULL) <> v_nq THEN
    RAISE EXCEPTION 'extra columns were not ignored';
  END IF;
  IF EXISTS (SELECT 1 FROM result_scores WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'marked before the key'; END IF;
  IF (SELECT status FROM results_student_list(v_proj, NULL, v_class, v_oly, 'waiting', v_r1, 5, 0) LIMIT 1) IS DISTINCT FROM 'waiting' THEN
    RAISE EXCEPTION 'student list does not show waiting';
  END IF;

  -- 4. Key typed in: incomplete -> still waiting; complete -> everyone marked.
  INSERT INTO questions (paper_id, question_number, correct_answer, check_status)
  SELECT v_paper, n, 'A', 'key_only' FROM generate_series(1, v_nq - 1) n;
  IF EXISTS (SELECT 1 FROM result_scores WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'marked with an incomplete key'; END IF;
  INSERT INTO questions (paper_id, question_number, correct_answer, check_status) VALUES (v_paper, v_nq, 'A', 'key_only');
  SELECT count(*) INTO v_n FROM result_scores WHERE paper_id = v_paper;
  IF v_n <> 3 THEN RAISE EXCEPTION 'expected 3 scores after the key, got %', v_n; END IF;
  SELECT total INTO v_total FROM result_scores WHERE enrollment_id = v_e1;
  IF v_total <> v_nq - 2 THEN RAISE EXCEPTION 'MULTIPLE / blank scoring: total % for % questions', v_total, v_nq; END IF;

  -- 5. An open AI-vs-key flag holds marking back; deciding it marks again.
  UPDATE questions SET check_status = 'mismatch_strong' WHERE paper_id = v_paper AND question_number = 1;
  IF EXISTS (SELECT 1 FROM result_scores WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'marked with an open flag'; END IF;
  UPDATE questions SET check_status = 'resolved' WHERE paper_id = v_paper AND question_number = 1;
  IF (SELECT count(*) FROM result_scores WHERE paper_id = v_paper) <> 3 THEN RAISE EXCEPTION 'not marked after the flag was decided'; END IF;

  -- 6. Upload again: replaces, and marks straight away now the key is finished.
  v_res := results_upload_omr(v_proj, 'good.xlsx', v_good, true);
  IF (v_res ->> 'replacing')::int <> 3 OR NOT (v_res #>> '{papers,0,keyReady}')::boolean THEN RAISE EXCEPTION 'dry run 2: %', v_res; END IF;
  v_res := results_upload_omr(v_proj, 'good.xlsx', v_good, false);
  IF (v_res ->> 'replaced')::int <> 3 THEN RAISE EXCEPTION 're-upload: %', v_res; END IF;
  IF (SELECT count(*) FROM result_evaluations WHERE enrollment_id IN (v_e1, v_e2, v_e3) AND deleted_at IS NULL) <> 3
     OR (SELECT count(*) FROM result_scores WHERE paper_id = v_paper) <> 3 THEN
    RAISE EXCEPTION 're-upload state';
  END IF;

  -- 7. Only active projects.
  BEGIN
    PERFORM results_upload_omr('da46555a-76f0-4767-890e-647896d5ff90', 'x.xlsx', v_good, true);
    RAISE EXCEPTION 'inactive project accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Results can only be saved for an active olympiad project%' THEN RAISE; END IF;
  END;
END
$t$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
