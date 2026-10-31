-- Test for supabase/migrations/20261102_results_evaluation.sql.
-- Run (only after the migration is applied):
--   supabase db query --linked -f supabase/tests/results_evaluation.sql
-- Everything happens inside one transaction that is rolled back, so no data is left
-- behind. Any failed assertion raises an exception; success ends with SELECT 'ALL PASS'.
--
-- Fixtures are real: the active project, its Slot 1 / Slot 2 templates, three real
-- MPO Class 3 enrolments from one school that has booked a slot, one MPO Class 1 and
-- one EPO Class 3 enrolment, and a real manager login. The test papers are created
-- inside the transaction. Any live MPO Class 1 / Class 3 papers and results are
-- soft-deleted first (inside the transaction) so ranks only see the test students.
--
-- Most checks run as that manager (role authenticated + request.jwt.claims). The two
-- steps that need more rights (marking a school released, back-dating a deletion)
-- briefly RESET ROLE to the CLI's postgres role.
BEGIN;

-- 0. Fixtures (as postgres). Values are handed to the later blocks via set_config.
DO $fx$
DECLARE
  v_proj   constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_school uuid;
  v_booked uuid;
  v_pslot  uuid;
  v_e      uuid[];
  v_r      text[];
  v_e4     uuid; v_r4 text;
  v_e5     uuid; v_r5 text;
  v_mgr    uuid;
  v_other  uuid;
BEGIN
  SELECT pe.school_id, es.slot_template_id INTO v_school, v_booked
    FROM portal_student_enrollments pe
    JOIN portal_registered_students st ON st.id = pe.student_id
    JOIN exam_slots es ON es.school_id = pe.school_id AND es.project_id = pe.project_id
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code = '03'
     AND pe.registration_number IS NOT NULL AND es.slot_template_id IS NOT NULL
   GROUP BY pe.school_id, es.slot_template_id
  HAVING count(*) >= 3
   ORDER BY count(*) DESC, pe.school_id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no school with 3 MPO Class 3 students and a booked slot'; END IF;

  -- The test paper goes on the OTHER slot, so the other-slot warning fires for all 3.
  SELECT id INTO v_pslot FROM exam_slot_templates
   WHERE project_id = v_proj AND id <> v_booked ORDER BY slot_name LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: project has only one slot template'; END IF;

  SELECT array_agg(x.id ORDER BY x.reg), array_agg(x.reg ORDER BY x.reg) INTO v_e, v_r
    FROM (SELECT pe.id, pe.registration_number AS reg
            FROM portal_student_enrollments pe
            JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_school
             AND pe.olympiad_code = 'MPO' AND st.class_code = '03'
             AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 3) x;

  SELECT pe.id, pe.registration_number INTO v_e4, v_r4
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code = '01'
     AND pe.registration_number IS NOT NULL
   ORDER BY pe.registration_number LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no MPO Class 1 enrolment'; END IF;

  SELECT pe.id, pe.registration_number INTO v_e5, v_r5
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'EPO' AND st.class_code = '03'
     AND pe.registration_number IS NOT NULL
   ORDER BY pe.registration_number LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no EPO Class 3 enrolment'; END IF;

  SELECT user_id INTO v_mgr FROM profiles WHERE role::text = 'manager' ORDER BY created_at, user_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no manager profile'; END IF;
  SELECT user_id INTO v_other FROM profiles WHERE role::text NOT IN ('manager','superadmin')
   ORDER BY created_at, user_id LIMIT 1;   -- may be NULL; that check is then skipped

  PERFORM set_config('test.proj',   v_proj::text, true);
  PERFORM set_config('test.school', v_school::text, true);
  PERFORM set_config('test.booked', v_booked::text, true);
  PERFORM set_config('test.pslot',  v_pslot::text, true);
  PERFORM set_config('test.e1', v_e[1]::text, true);
  PERFORM set_config('test.e2', v_e[2]::text, true);
  PERFORM set_config('test.e3', v_e[3]::text, true);
  PERFORM set_config('test.r1', v_r[1], true);
  PERFORM set_config('test.r2', v_r[2], true);
  PERFORM set_config('test.r3', v_r[3], true);
  PERFORM set_config('test.e4', v_e4::text, true);
  PERFORM set_config('test.r4', v_r4, true);
  PERFORM set_config('test.e5', v_e5::text, true);
  PERFORM set_config('test.r5', v_r5, true);
  PERFORM set_config('test.mgr', v_mgr::text, true);
  PERFORM set_config('test.other', COALESCE(v_other::text, ''), true);
END
$fx$;

-- Impersonate the manager.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 1. Uploads: validation, all-or-nothing, scoring, ranks, re-upload.
DO $b$
DECLARE
  v_proj  uuid := current_setting('test.proj')::uuid;
  v_pslot uuid := current_setting('test.pslot')::uuid;
  v_e1 uuid := current_setting('test.e1')::uuid;
  v_e2 uuid := current_setting('test.e2')::uuid;
  v_e3 uuid := current_setting('test.e3')::uuid;
  v_e4 uuid := current_setting('test.e4')::uuid;
  v_e5 uuid := current_setting('test.e5')::uuid;
  v_r1 text := current_setting('test.r1');
  v_r2 text := current_setting('test.r2');
  v_r3 text := current_setting('test.r3');
  v_r4 text := current_setting('test.r4');
  v_r5 text := current_setting('test.r5');
  v_paper uuid;
  v_man   uuid;
  v_draft uuid;
  v_res   jsonb;
  v_rows  jsonb;
  v_n     int;
  v_old3  uuid;
  v_new3  uuid;
  v_slot_name text;
  v_s     result_scores%ROWTYPE;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'FIXTURE: impersonation failed (auth.uid() = %)', auth.uid();
  END IF;

  -- Clean slate for the two groups the test uses.
  PERFORM results_delete_evaluations(ARRAY(
    SELECT pe.id FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
     WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code IN ('01','03')));
  UPDATE question_papers SET deleted_at = now()
   WHERE project_id = v_proj AND olympiad_code = 'MPO' AND class_code IN ('01','03') AND deleted_at IS NULL;

  -- Test papers: Ready OMR Class 3 MPO (key A,B,C,D,A), a draft one, a Ready manual Class 1.
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions, status)
  VALUES (v_proj, '03', 'MPO', v_pslot, 5, 'ready') RETURNING id INTO v_paper;
  INSERT INTO questions (paper_id, question_number, correct_answer)
  SELECT v_paper, k.n, k.a FROM unnest(ARRAY['A','B','C','D','A']) WITH ORDINALITY AS k(a, n);
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions, status)
  VALUES (v_proj, '03', 'MPO', current_setting('test.booked')::uuid, 5, 'draft') RETURNING id INTO v_draft;
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions, status)
  VALUES (v_proj, '01', 'MPO', v_pslot, 5, 'ready') RETURNING id INTO v_man;
  INSERT INTO questions (paper_id, question_number) SELECT v_man, n FROM generate_series(1, 5) n;

  -- (a) unknown registration number: exact message, nothing inserted.
  v_res := results_upload(v_paper, 'omr', 't.csv',
             '[{"row":2,"reg":"9999999999999","values":["A","B","C","D","A"]}]'::jsonb, true);
  IF (v_res->>'ok')::boolean IS DISTINCT FROM false
     OR v_res->'errors'->0->>'message' IS DISTINCT FROM 'Row 2: 9999999999999 is not a registered student in this project' THEN
    RAISE EXCEPTION 'FAIL a: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM result_evaluations WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'FAIL a2: rows inserted'; END IF;

  -- (a3) each row-level message, in row order.
  v_rows := jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', v_r1, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 3, 'reg', results_digits(v_r1), 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 4, 'reg', v_r4, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 5, 'reg', v_r5, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 6, 'reg', '', 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 7, 'reg', v_r2, 'values', jsonb_build_array('A','B','C','D')));
  v_res := results_upload(v_paper, 'omr', 't.csv', v_rows, true);
  IF (SELECT jsonb_agg(x->'message') FROM jsonb_array_elements(v_res->'errors') x) IS DISTINCT FROM jsonb_build_array(
       format('Row 3: %s appears twice in this file (rows 2 and 3)', results_digits(v_r1)),
       format('Row 4: %s is a Class 1 student, but this paper is Class 3', v_r4),
       format('Row 5: %s is registered for English, but this paper is Maths', v_r5),
       'Row 6 has no registration number',
       'Row 7 has 4 answers; this paper has 5 questions')
     OR (v_res->>'moreErrors')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL a3: %', v_res->'errors';
  END IF;

  -- (b) one bad row among good rows, REAL run: rejected, nothing saved.
  v_rows := jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', v_r1, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 3, 'reg', v_r2, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 4, 'reg', '9999999999999', 'values', jsonb_build_array('A','B','C','D','A')));
  v_res := results_upload(v_paper, 'omr', 't.csv', v_rows, false);
  IF (v_res->>'ok')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL b: %', v_res; END IF;
  SELECT count(*) INTO v_n FROM result_evaluations WHERE paper_id = v_paper;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL b2: % evaluations exist after a rejected file', v_n; END IF;
  IF EXISTS (SELECT 1 FROM result_upload_batches WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'FAIL b3: batch saved'; END IF;

  -- (c1) invalid answer letter.
  v_res := results_upload(v_paper, 'omr', 't.csv',
             jsonb_build_array(jsonb_build_object('row', 2, 'reg', v_r1, 'values', '["A",null,"X","D","A"]'::jsonb)), true);
  IF v_res->'errors'->0->>'message' IS DISTINCT FROM 'Row 2, Q3: "X" is not A, B, C or D' THEN
    RAISE EXCEPTION 'FAIL c1: %', v_res;
  END IF;

  -- (d) hyphenated, digits-only and spaced registration numbers all match; lower case is accepted.
  v_rows := jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', v_r1, 'values', jsonb_build_array('A','B','C','D','A')),
    jsonb_build_object('row', 3, 'reg', results_digits(v_r2), 'values', jsonb_build_array('a','b','c','d','a')),
    jsonb_build_object('row', 4, 'reg', ' ' || replace(v_r3, '-', ' ') || ' ', 'values', '["B",null,"C","D","A"]'::jsonb));
  -- Review focus 5: dry run warns about the other slot and counts nothing as replaced.
  v_res := results_upload(v_paper, 'omr', 't.csv', v_rows, true);
  SELECT slot_name INTO v_slot_name FROM exam_slot_templates WHERE id = current_setting('test.booked')::uuid;
  IF (v_res->>'ok')::boolean IS DISTINCT FROM true OR (v_res->>'dryRun')::boolean IS DISTINCT FROM true
     OR (v_res->>'count')::int <> 3 OR v_res->'replace' <> '[]'::jsonb
     OR (v_res->'otherSlot'->>'count')::int <> 3 OR v_res->'otherSlot'->>'slotName' IS DISTINCT FROM v_slot_name
     OR jsonb_typeof(v_res->'missingFromFile') <> 'number' THEN
    RAISE EXCEPTION 'FAIL d1 (dry run summary): %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM result_evaluations WHERE paper_id = v_paper) THEN RAISE EXCEPTION 'FAIL d2: dry run saved rows'; END IF;
  v_res := results_upload(v_paper, 'omr', 'answers.csv', v_rows, false);
  IF (v_res->>'ok')::boolean IS DISTINCT FROM true OR (v_res->>'saved')::int <> 3 OR (v_res->>'replaced')::int <> 0
     OR v_res->>'batchId' IS NULL THEN
    RAISE EXCEPTION 'FAIL d3: %', v_res;
  END IF;

  -- (c2) total 5, percentage 100, grade A++.
  SELECT * INTO v_s FROM result_scores WHERE enrollment_id = v_e1;
  IF NOT FOUND OR v_s.total <> 5 OR v_s.percentage <> 100 OR v_s.grade <> 'A++' OR v_s.max_marks <> 5 THEN
    RAISE EXCEPTION 'FAIL c2: e1 total %, % pct, grade %', v_s.total, v_s.percentage, v_s.grade;
  END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e2) <> 5 THEN RAISE EXCEPTION 'FAIL c3: lower-case answers not scored'; END IF;
  SELECT * INTO v_s FROM result_scores WHERE enrollment_id = v_e3;
  IF NOT FOUND OR v_s.total <> 3 OR v_s.percentage <> 60 OR v_s.grade <> 'B' THEN
    RAISE EXCEPTION 'FAIL c4: e3 total %, % pct, grade %', v_s.total, v_s.percentage, v_s.grade;
  END IF;
  IF v_s.state_code <> substr(results_digits(v_r3), 2, 2) OR v_s.district_key <> substr(results_digits(v_r3), 2, 4) THEN
    RAISE EXCEPTION 'FAIL c5: state/district from reg wrong: % / %', v_s.state_code, v_s.district_key;
  END IF;

  -- (f) ties share a rank, the next one skips: 1, 1, 3 at every level.
  IF (SELECT array_agg(ARRAY[rank_school, rank_district, rank_state, rank_national] ORDER BY enrollment_id = v_e3, enrollment_id)
        FROM result_scores WHERE enrollment_id IN (v_e1, v_e2, v_e3))
     IS DISTINCT FROM ARRAY[ARRAY[1,1,1,1], ARRAY[1,1,1,1], ARRAY[3,3,3,3]] THEN
    RAISE EXCEPTION 'FAIL f: ranks %', (SELECT array_agg(ARRAY[rank_school, rank_district, rank_state, rank_national])
                                         FROM result_scores WHERE enrollment_id IN (v_e1, v_e2, v_e3));
  END IF;

  -- (e) re-upload: dry run lists the student; real run soft-deletes the old row.
  SELECT id INTO v_old3 FROM result_evaluations WHERE enrollment_id = v_e3 AND deleted_at IS NULL;
  v_rows := jsonb_build_array(jsonb_build_object('row', 2, 'reg', v_r3, 'values', '["B",null,"C","D","A"]'::jsonb));
  v_res := results_upload(v_paper, 'omr', 'again.csv', v_rows, true);
  IF jsonb_array_length(v_res->'replace') <> 1 OR v_res->'replace'->0->>'reg' IS DISTINCT FROM v_r3
     OR v_res->'replace'->0->>'was' IS DISTINCT FROM 'evaluated' OR v_res->'replace'->0->>'name' IS NULL THEN
    RAISE EXCEPTION 'FAIL e1: %', v_res;
  END IF;
  v_res := results_upload(v_paper, 'omr', 'again.csv', v_rows, false);
  IF (v_res->>'saved')::int <> 1 OR (v_res->>'replaced')::int <> 1 THEN RAISE EXCEPTION 'FAIL e2: %', v_res; END IF;
  IF (SELECT deleted_at FROM result_evaluations WHERE id = v_old3) IS NULL THEN RAISE EXCEPTION 'FAIL e3: old row not soft-deleted'; END IF;
  SELECT id INTO v_new3 FROM result_evaluations WHERE enrollment_id = v_e3 AND deleted_at IS NULL;
  IF v_new3 IS NULL OR v_new3 = v_old3 THEN RAISE EXCEPTION 'FAIL e4: no new live row'; END IF;
  IF (SELECT replaced_count FROM result_upload_batches WHERE id = (v_res->>'batchId')::uuid) <> 1 THEN
    RAISE EXCEPTION 'FAIL e5: batch replaced_count';
  END IF;
  IF (SELECT evaluation_id FROM result_scores WHERE enrollment_id = v_e3) IS DISTINCT FROM v_new3 THEN
    RAISE EXCEPTION 'FAIL e6: score not rebuilt from the new row';
  END IF;

  PERFORM set_config('test.paper', v_paper::text, true);
  PERFORM set_config('test.man',   v_man::text, true);
  PERFORM set_config('test.draft', v_draft::text, true);
  PERFORM set_config('test.old3',  v_old3::text, true);
  PERFORM set_config('test.new3',  v_new3::text, true);
END
$b$;

-- Mark the test school released (managers can't write school_result_release).
RESET ROLE;
INSERT INTO school_result_release (school_id, project_id, released_by, notes)
VALUES (current_setting('test.school')::uuid, current_setting('test.proj')::uuid,
        current_setting('test.mgr')::uuid, 'results_evaluation test')
ON CONFLICT (school_id, project_id) DO NOTHING;
SET LOCAL ROLE authenticated;

-- 2. Key changes, grace, resend flags, corrections, absent, delete / restore, manual,
--    privileges, draft paper, read RPCs.
DO $c$
DECLARE
  v_proj   uuid := current_setting('test.proj')::uuid;
  v_school uuid := current_setting('test.school')::uuid;
  v_paper  uuid := current_setting('test.paper')::uuid;
  v_man    uuid := current_setting('test.man')::uuid;
  v_draft  uuid := current_setting('test.draft')::uuid;
  v_old3   uuid := current_setting('test.old3')::uuid;
  v_new3   uuid := current_setting('test.new3')::uuid;
  v_e1 uuid := current_setting('test.e1')::uuid;
  v_e2 uuid := current_setting('test.e2')::uuid;
  v_e3 uuid := current_setting('test.e3')::uuid;
  v_e4 uuid := current_setting('test.e4')::uuid;
  v_r3 text := current_setting('test.r3');
  v_r4 text := current_setting('test.r4');
  v_ev1 uuid;
  v_ev2 uuid;
  v_res jsonb;
  v_n   int;
  v_msg text;
  v_before jsonb;
  v_after  jsonb;
  v_s   result_scores%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM result_resend_flags WHERE project_id = v_proj AND school_id = v_school AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL m0: an open resend flag already exists before any change';
  END IF;

  -- (g) Q1 key A -> B re-scores in the same statement: e1 5 -> 4, e3 (answered B) 3 -> 4.
  UPDATE questions SET correct_answer = 'B' WHERE paper_id = v_paper AND question_number = 1;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> 4 THEN RAISE EXCEPTION 'FAIL g1: e1 not re-scored'; END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e3) <> 4 THEN RAISE EXCEPTION 'FAIL g2: e3 not re-scored'; END IF;
  IF (SELECT array_agg(rank_school) FROM result_scores WHERE enrollment_id IN (v_e1, v_e2, v_e3)) <> ARRAY[1,1,1] THEN
    RAISE EXCEPTION 'FAIL g3: three-way tie should all rank 1';
  END IF;

  -- (m) the released school now has exactly one open resend flag.
  SELECT count(*) INTO v_n FROM result_resend_flags
   WHERE project_id = v_proj AND school_id = v_school AND cleared_at IS NULL AND reason = 'Scores changed after release';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL m1: expected 1 open resend flag, got %', v_n; END IF;

  -- (h) grace on Q2: e3 (blank on Q2) gains the mark, e1 / e2 (already right) stay at 4.
  UPDATE questions SET is_grace = true WHERE paper_id = v_paper AND question_number = 2;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e3) <> 5 THEN RAISE EXCEPTION 'FAIL h1: grace not given'; END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> 4 THEN RAISE EXCEPTION 'FAIL h2: grace double-counted'; END IF;
  IF (SELECT rank_national FROM result_scores WHERE enrollment_id = v_e3) <> 1
     OR (SELECT rank_national FROM result_scores WHERE enrollment_id = v_e1) <> 2 THEN
    RAISE EXCEPTION 'FAIL h3: ranks not recomputed after grace';
  END IF;
  -- still one open flag (an uncleared flag is not duplicated)
  SELECT count(*) INTO v_n FROM result_resend_flags WHERE project_id = v_proj AND school_id = v_school AND cleared_at IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL m2: open flags duplicated (%)', v_n; END IF;

  -- Correct one answer: e1 Q3 C -> A drops a mark; audit keeps before / after.
  SELECT id INTO v_ev1 FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL;
  PERFORM results_correct_answer(v_ev1, 3, 'a');
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> 3 THEN RAISE EXCEPTION 'FAIL ca1: correction not re-scored'; END IF;
  SELECT before, after INTO v_before, v_after FROM result_audit_log
   WHERE table_name = 'result_evaluations' AND row_id = v_ev1 AND action = 'UPDATE'
   ORDER BY id DESC LIMIT 1;
  IF v_before->'answers'->>2 IS DISTINCT FROM 'C' OR v_after->'answers'->>2 IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'FAIL ca2: audit before/after % / %', v_before->'answers', v_after->'answers';
  END IF;
  v_msg := NULL;
  BEGIN PERFORM results_correct_answer(v_ev1, 3, 'E'); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Q3: "E" is not A, B, C or D' THEN RAISE EXCEPTION 'FAIL ca3: %', v_msg; END IF;
  v_msg := NULL;
  BEGIN PERFORM results_correct_answer(v_ev1, 9, 'A'); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'This paper has 5 questions, so there is no Q9.' THEN RAISE EXCEPTION 'FAIL ca4: %', v_msg; END IF;
  PERFORM results_correct_answer(v_ev1, 3, 'C');   -- back to 4
  PERFORM results_correct_answer(v_ev1, 4, '');    -- blank -> unanswered: 3
  IF (SELECT answers[4] FROM result_evaluations WHERE id = v_ev1) IS NOT NULL
     OR (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> 3 THEN
    RAISE EXCEPTION 'FAIL ca5: blank correction';
  END IF;
  PERFORM results_correct_answer(v_ev1, 4, 'D');   -- back to 4

  -- (i) absent: no score row; the others re-rank (e1, e2 back to rank 1).
  v_n := results_set_absent(v_paper, ARRAY[v_e3], true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL i1: set_absent returned %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM result_scores WHERE enrollment_id = v_e3) THEN RAISE EXCEPTION 'FAIL i2: absent student still scored'; END IF;
  IF (SELECT status FROM result_evaluations WHERE enrollment_id = v_e3 AND deleted_at IS NULL) IS DISTINCT FROM 'absent' THEN
    RAISE EXCEPTION 'FAIL i3: no live absent row';
  END IF;
  IF (SELECT array_agg(rank_national) FROM result_scores WHERE enrollment_id IN (v_e1, v_e2)) <> ARRAY[1,1] THEN
    RAISE EXCEPTION 'FAIL i4: others not re-ranked';
  END IF;
  -- marking absent again changes nothing
  IF results_set_absent(v_paper, ARRAY[v_e3], true) <> 0 THEN RAISE EXCEPTION 'FAIL i5: absent twice'; END IF;
  -- a student from another class / olympiad is refused
  v_msg := NULL;
  BEGIN PERFORM results_set_absent(v_paper, ARRAY[v_e4], true); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Nothing was changed: 1 of the selected students is not registered for this paper.' THEN
    RAISE EXCEPTION 'FAIL i6: %', v_msg;
  END IF;
  -- Review focus 4: an absent student in an uploaded file is listed as replaced (was: absent).
  v_res := results_upload(v_paper, 'omr', 'late.csv',
             jsonb_build_array(jsonb_build_object('row', 2, 'reg', v_r3, 'values', '["B","B","C","D","A"]'::jsonb)), true);
  IF v_res->'replace'->0->>'was' IS DISTINCT FROM 'absent' THEN RAISE EXCEPTION 'FAIL i7: %', v_res; END IF;
  -- present again: the absent row is soft-deleted, the student is Pending.
  v_n := results_set_absent(v_paper, ARRAY[v_e3], false);
  IF v_n <> 1 OR EXISTS (SELECT 1 FROM result_evaluations WHERE enrollment_id = v_e3 AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL i8: present did not clear the absent mark';
  END IF;
  IF (SELECT status FROM results_student_list(v_proj, v_school, '03', 'MPO', 'pending', v_r3, 10, 0) LIMIT 1) IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL i9: student list does not show Pending';
  END IF;

  -- Delete / restore.
  SELECT id INTO v_ev2 FROM result_evaluations WHERE enrollment_id = v_e2 AND deleted_at IS NULL;
  IF results_delete_evaluations(ARRAY[v_e2]) <> 1 THEN RAISE EXCEPTION 'FAIL r1: delete count'; END IF;
  IF EXISTS (SELECT 1 FROM result_scores WHERE enrollment_id = v_e2) THEN RAISE EXCEPTION 'FAIL r2: deleted student still scored'; END IF;
  IF NOT EXISTS (SELECT 1 FROM results_student_list(v_proj, v_school, NULL, NULL, 'deleted', NULL, 100, 0) WHERE evaluation_id = v_ev2) THEN
    RAISE EXCEPTION 'FAIL r3: deleted result not listed';
  END IF;
  PERFORM results_restore_evaluation(v_ev2);
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e2) <> 4 THEN RAISE EXCEPTION 'FAIL r4: restore not re-scored'; END IF;
  -- e3 has no live result: its first result comes back (B,_,C,D,A with key B,B(grace),C,D,A = 5) ...
  PERFORM results_restore_evaluation(v_old3);
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e3) <> 5 THEN RAISE EXCEPTION 'FAIL r5: restored e3 not scored'; END IF;
  -- ... and then the later one is refused.
  v_msg := NULL;
  BEGIN PERFORM results_restore_evaluation(v_new3); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'This student already has a newer result.' THEN RAISE EXCEPTION 'FAIL r6: %', v_msg; END IF;

  -- (j) manual paper: marks 1, 0.5, 0, 1, 0.5 = 3.0 -> 60% -> B.
  v_res := results_upload(v_man, 'manual', 'kids.csv',
             jsonb_build_array(jsonb_build_object('row', 2, 'reg', v_r4, 'values', '[1,"2",0,1,0]'::jsonb)), true);
  IF v_res->'errors'->0->>'message' IS DISTINCT FROM 'Row 2, Q2: "2" must be 0, 0.5 or 1' THEN RAISE EXCEPTION 'FAIL j1: %', v_res; END IF;
  v_res := results_upload(v_man, 'manual', 'kids.csv',
             jsonb_build_array(jsonb_build_object('row', 2, 'reg', v_r4, 'values', '[1,0.5,0,"1",".5"]'::jsonb)), false);
  IF (v_res->>'saved')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL j2: %', v_res; END IF;
  SELECT * INTO v_s FROM result_scores WHERE enrollment_id = v_e4;
  IF NOT FOUND OR v_s.total <> 3.0 OR v_s.percentage <> 60 OR v_s.grade <> 'B' THEN
    RAISE EXCEPTION 'FAIL j3: manual total %, % pct, grade %', v_s.total, v_s.percentage, v_s.grade;
  END IF;
  IF (SELECT marks FROM result_evaluations WHERE enrollment_id = v_e4 AND deleted_at IS NULL) <> ARRAY[1,0.5,0,1,0.5]::numeric(2,1)[] THEN
    RAISE EXCEPTION 'FAIL j4: marks not stored as given';
  END IF;
  PERFORM results_correct_answer((SELECT id FROM result_evaluations WHERE enrollment_id = v_e4 AND deleted_at IS NULL), 3, '0.5');
  IF (SELECT percentage FROM result_scores WHERE enrollment_id = v_e4) <> 70 THEN RAISE EXCEPTION 'FAIL j5: manual correction'; END IF;
  v_msg := NULL;
  BEGIN PERFORM results_correct_answer((SELECT id FROM result_evaluations WHERE enrollment_id = v_e4 AND deleted_at IS NULL), 3, 'A');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Q3: "A" must be 0, 0.5 or 1' THEN RAISE EXCEPTION 'FAIL j6: %', v_msg; END IF;
  -- the wrong tab is refused
  v_msg := NULL;
  BEGIN PERFORM results_upload(v_man, 'omr', 'x.csv', '[{"row":2,"reg":"1","values":[]}]'::jsonb, true);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Class 1 papers are marked by hand. Upload this file on the Manual tab.' THEN RAISE EXCEPTION 'FAIL j7: %', v_msg; END IF;

  -- (k) privileges.
  IF has_table_privilege('anon', 'public.result_scores', 'SELECT') THEN RAISE EXCEPTION 'FAIL k1: anon can read result_scores'; END IF;
  IF has_table_privilege('anon', 'public.result_evaluations', 'SELECT') THEN RAISE EXCEPTION 'FAIL k2: anon can read result_evaluations'; END IF;
  IF has_function_privilege('anon', 'public.results_upload(uuid,text,text,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL k3: anon can call results_upload';
  END IF;
  IF has_function_privilege('authenticated', 'public.results_rescore_paper_core(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL k4: authenticated can call the core rescore';
  END IF;
  v_msg := NULL;
  BEGIN
    INSERT INTO result_evaluations (enrollment_id, paper_id, status) VALUES (v_e2, v_paper, 'absent');
  EXCEPTION WHEN insufficient_privilege THEN v_msg := 'denied'; END;
  IF v_msg IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FAIL k5: authenticated inserted into result_evaluations directly'; END IF;
  v_msg := NULL;
  BEGIN
    UPDATE result_scores SET total = 0 WHERE enrollment_id = v_e1;
  EXCEPTION WHEN insufficient_privilege THEN v_msg := 'denied'; END;
  IF v_msg IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FAIL k6: authenticated updated result_scores directly'; END IF;

  -- (l) a draft paper refuses uploads.
  v_msg := NULL;
  BEGIN PERFORM results_upload(v_draft, 'omr', 'x.csv', '[{"row":2,"reg":"1","values":[]}]'::jsonb, true);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'This paper isn''t marked Ready yet. Finish its answer key on the Question Papers page first.' THEN
    RAISE EXCEPTION 'FAIL l: %', v_msg;
  END IF;

  -- Read RPCs.
  IF NOT EXISTS (SELECT 1 FROM results_school_summary(v_proj)
                  WHERE school_id = v_school AND released AND resend_flag AND evaluated >= 3
                    AND avg_percentage IS NOT NULL AND school_grade IS NOT NULL AND state_avg_percentage IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL s1: school summary %', (SELECT row_to_json(x) FROM results_school_summary(v_proj) x WHERE x.school_id = v_school);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM results_class_olympiad_summary(v_proj, v_school)
                  WHERE class_code = '03' AND olympiad_code = 'MPO' AND evaluated = 3 AND avg_percentage IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL s2: class x olympiad summary';
  END IF;
  IF (SELECT array_agg(enrollment_id ORDER BY rank_national, registration_number)
        FROM results_rank_list(v_proj, '03', 'MPO', 10, 0)) IS NULL
     OR (SELECT enrollment_id FROM results_rank_list(v_proj, '03', 'MPO', 1, 0)) IS DISTINCT FROM v_e3
     OR (SELECT total_count FROM results_rank_list(v_proj, '03', 'MPO', 1, 0)) <> 3
     OR (SELECT district_name FROM results_rank_list(v_proj, '03', 'MPO', 1, 0)) IS NULL THEN
    RAISE EXCEPTION 'FAIL s3: rank list';
  END IF;
  IF (SELECT count(*) FROM results_rank_list(v_proj, '03', 'MPO', 10, 0, NULL, NULL, v_school)) <> 3
     OR (SELECT count(*) FROM results_rank_list(v_proj, '03', 'MPO', 10, 0, '00')) <> 0 THEN
    RAISE EXCEPTION 'FAIL s4: rank list filters';
  END IF;
  IF (SELECT total_count FROM results_student_list(v_proj, v_school, '03', 'MPO', 'evaluated', NULL, 1, 0)) <> 3 THEN
    RAISE EXCEPTION 'FAIL s5: student list total_count';
  END IF;

  -- Non-managers are refused.
  IF current_setting('test.other') <> '' THEN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', current_setting('test.other'), 'role', 'authenticated')::text, true);
    v_msg := NULL;
    BEGIN PERFORM results_upload(v_paper, 'omr', 'x.csv', '[]'::jsonb, true); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    IF v_msg IS DISTINCT FROM 'Only managers can do this.' THEN RAISE EXCEPTION 'FAIL n1: %', v_msg; END IF;
    IF EXISTS (SELECT 1 FROM results_released_school_ids(v_proj)) THEN RAISE EXCEPTION 'FAIL n2: release list leaked'; END IF;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
  END IF;
END
$c$;

-- 3. Restore window: a result deleted more than 30 days ago can't come back.
RESET ROLE;
UPDATE result_evaluations SET deleted_at = now() - interval '31 days'
 WHERE id = current_setting('test.new3')::uuid;
SET LOCAL ROLE authenticated;
DO $d$
DECLARE
  v_msg text;
BEGIN
  PERFORM results_delete_evaluations(ARRAY[current_setting('test.e3')::uuid]);
  BEGIN PERFORM results_restore_evaluation(current_setting('test.new3')::uuid); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'This result was deleted more than 30 days ago and can no longer be restored.' THEN
    RAISE EXCEPTION 'FAIL d1: %', v_msg;
  END IF;
END
$d$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
