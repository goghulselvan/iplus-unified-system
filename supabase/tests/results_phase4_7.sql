-- Test for supabase/migrations/20261103_results_phase4_7.sql.
-- Run (only after the migration is applied):
--   supabase db query --linked -f supabase/tests/results_phase4_7.sql
-- Everything happens inside one transaction that is rolled back, so no data is left
-- behind. Any failed assertion raises an exception; success ends with SELECT 'ALL PASS'.
--
-- The project id below is hard-coded to the 2026 project (dd5de83d-...). Update it
-- before running this against a later project.
--
-- Fixtures are real: school A = a school with an active portal login and >= 6 MPO
-- Class 4 enrolments, school B = another school with >= 2, school C = any third school,
-- one MPO Class 1 enrolment (manual marks), a real manager, a real superadmin, A's real
-- portal login. Test papers / results are created inside the transaction; any live MPO
-- Class 1 / Class 4 papers and results are soft-deleted first (inside the transaction).
--
-- NOTE: school_result_release has a live trigger that queues a pg_net call to
-- notify-results-released. pg_net only sends queued requests after COMMIT, and this
-- test always rolls back, so nothing is sent.
BEGIN;

-- 0. Fixtures (as postgres).
DO $fx$
DECLARE
  v_proj  constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_a     uuid;
  v_b     uuid;
  v_c     uuid;
  v_ea    uuid[];
  v_eb    uuid[];
  v_rb    text[];
  v_em    uuid;
  v_rm    text;
  v_mgr   uuid;
  v_sa    uuid;
  v_portal uuid;
  v_other uuid;
  v_slot  uuid;
BEGIN
  SELECT pe.school_id, min(spa.user_id::text)::uuid INTO v_a, v_portal
    FROM portal_student_enrollments pe
    JOIN portal_registered_students st ON st.id = pe.student_id
    JOIN school_portal_accounts spa ON spa.school_id = pe.school_id AND spa.is_active
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code = '04'
     AND pe.registration_number IS NOT NULL
   GROUP BY pe.school_id
  HAVING count(DISTINCT pe.id) >= 6 AND count(DISTINCT spa.user_id) = 1
   ORDER BY count(DISTINCT pe.id), pe.school_id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no portal school with 6 MPO Class 4 students'; END IF;

  SELECT pe.school_id INTO v_b
    FROM portal_student_enrollments pe
    JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code = '04'
     AND pe.registration_number IS NOT NULL AND pe.school_id <> v_a
   GROUP BY pe.school_id HAVING count(*) >= 2
   ORDER BY count(*), pe.school_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no second school with 2 MPO Class 4 students'; END IF;

  SELECT id INTO v_c FROM schools WHERE id NOT IN (v_a, v_b) ORDER BY id LIMIT 1;

  SELECT array_agg(x.id ORDER BY x.reg) INTO v_ea
    FROM (SELECT pe.id, pe.registration_number AS reg
            FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_a AND pe.olympiad_code = 'MPO'
             AND st.class_code = '04' AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 6) x;
  SELECT array_agg(x.id ORDER BY x.reg), array_agg(x.reg ORDER BY x.reg) INTO v_eb, v_rb
    FROM (SELECT pe.id, pe.registration_number AS reg
            FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_b AND pe.olympiad_code = 'MPO'
             AND st.class_code = '04' AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 2) x;

  SELECT pe.id, pe.registration_number INTO v_em, v_rm
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code = '01'
     AND pe.registration_number IS NOT NULL
   ORDER BY pe.registration_number LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no MPO Class 1 enrolment'; END IF;

  SELECT user_id INTO v_mgr FROM profiles WHERE role::text = 'manager' ORDER BY created_at, user_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no manager profile'; END IF;
  SELECT user_id INTO v_sa FROM profiles WHERE role::text = 'superadmin' ORDER BY created_at, user_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no superadmin profile'; END IF;
  SELECT user_id INTO v_other FROM profiles WHERE role::text NOT IN ('manager','superadmin')
   ORDER BY created_at, user_id LIMIT 1;   -- may be NULL; that check is then skipped
  SELECT id INTO v_slot FROM exam_slot_templates WHERE project_id = v_proj ORDER BY slot_name LIMIT 1;

  PERFORM set_config('test.proj', v_proj::text, true);
  PERFORM set_config('test.a', v_a::text, true);
  PERFORM set_config('test.b', v_b::text, true);
  PERFORM set_config('test.c', COALESCE(v_c::text, ''), true);
  PERFORM set_config('test.ea', v_ea::text, true);
  PERFORM set_config('test.eb', v_eb::text, true);
  PERFORM set_config('test.rb1', v_rb[1], true);
  PERFORM set_config('test.rb2', v_rb[2], true);
  PERFORM set_config('test.em', v_em::text, true);
  PERFORM set_config('test.rm', v_rm, true);
  PERFORM set_config('test.mgr', v_mgr::text, true);
  PERFORM set_config('test.sa', v_sa::text, true);
  PERFORM set_config('test.portal', v_portal::text, true);
  PERFORM set_config('test.other', COALESCE(v_other::text, ''), true);
  PERFORM set_config('test.slot', v_slot::text, true);
END
$fx$;

-- Impersonate the manager.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 1. Papers, uploads, skills, read RPCs, corrections.
DO $s$
DECLARE
  v_proj uuid := current_setting('test.proj')::uuid;
  v_a    uuid := current_setting('test.a')::uuid;
  v_b    uuid := current_setting('test.b')::uuid;
  v_ea   uuid[] := current_setting('test.ea')::uuid[];
  v_eb   uuid[] := current_setting('test.eb')::uuid[];
  v_em   uuid := current_setting('test.em')::uuid;
  v_slot uuid := current_setting('test.slot')::uuid;
  v_paper uuid;
  v_man   uuid;
  v_rows  jsonb;
  v_res   jsonb;
  v_ev    uuid;
  v_msg   text;
  v_reg   int;
  r       record;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'FIXTURE: impersonation failed (auth.uid() = %)', auth.uid();
  END IF;

  -- Clean slate for the two groups the test uses.
  PERFORM results_delete_evaluations(ARRAY(
    SELECT pe.id FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
     WHERE pe.project_id = v_proj AND pe.olympiad_code = 'MPO' AND st.class_code IN ('01','04')));
  UPDATE question_papers SET deleted_at = now()
   WHERE project_id = v_proj AND olympiad_code = 'MPO' AND class_code IN ('01','04') AND deleted_at IS NULL;

  -- OMR Class 4 paper: key A,B,C,D,A; Q5 is grace. Skills: Q1-2 Number Systems,
  -- Q3 Algebra, Q4-5 Geometry.
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions, status)
  VALUES (v_proj, '04', 'MPO', v_slot, 5, 'ready') RETURNING id INTO v_paper;
  INSERT INTO questions (paper_id, question_number, correct_answer, is_grace, skill_category)
  VALUES (v_paper, 1, 'A', false, 'Number Systems'), (v_paper, 2, 'B', false, 'Number Systems'),
         (v_paper, 3, 'C', false, 'Algebra'), (v_paper, 4, 'D', false, 'Geometry'),
         (v_paper, 5, 'A', true, 'Geometry');
  -- Manual Class 1 paper, 4 questions: Q1-2 Number Systems, Q3-4 Measurement.
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions, status)
  VALUES (v_proj, '01', 'MPO', v_slot, 4, 'ready') RETURNING id INTO v_man;
  INSERT INTO questions (paper_id, question_number, skill_category)
  VALUES (v_man, 1, 'Number Systems'), (v_man, 2, 'Number Systems'), (v_man, 3, 'Measurement'), (v_man, 4, 'Measurement');

  -- A1..A5 identical (A,B,C,A,B) = 4; A6 (D,A,B,C,A) = 1; B1, B2 all right = 5.
  SELECT jsonb_agg(x) INTO v_rows FROM (
    SELECT jsonb_build_object('row', i + 1, 'reg', pe.registration_number,
                              'values', CASE WHEN i <= 5 THEN '["A","B","C","A","B"]'::jsonb
                                             ELSE '["D","A","B","C","A"]'::jsonb END) AS x
      FROM unnest(v_ea) WITH ORDINALITY AS u(id, i) JOIN portal_student_enrollments pe ON pe.id = u.id
    UNION ALL
    SELECT jsonb_build_object('row', 10 + i, 'reg', pe.registration_number, 'values', '["A","B","C","D","A"]'::jsonb)
      FROM unnest(v_eb) WITH ORDINALITY AS u(id, i) JOIN portal_student_enrollments pe ON pe.id = u.id) t;
  v_res := results_upload(v_paper, 'omr', 'p47.csv', v_rows, false);
  IF (v_res->>'saved')::int IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'FIXTURE: upload %', v_res; END IF;
  v_res := results_upload(v_man, 'manual', 'p47m.csv',
             jsonb_build_array(jsonb_build_object('row', 2, 'reg', current_setting('test.rm'),
                                                  'values', '[1,0.5,0.5,0]'::jsonb)), false);
  IF (v_res->>'saved')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FIXTURE: manual upload %', v_res; END IF;

  -- (sk1) skills with a grace question: A1 answered B on grace Q5 and still gets it.
  IF (SELECT array_agg(ARRAY[s.skill, s.correct::text, s.total::text, s.percentage::text] ORDER BY s.skill)
        FROM results_student_skills(v_ea[1]) s)
     IS DISTINCT FROM ARRAY[ARRAY['Algebra','1','1','100'], ARRAY['Geometry','1','2','50'],
                            ARRAY['Number Systems','2','2','100']] THEN
    RAISE EXCEPTION 'FAIL sk1: %', (SELECT array_agg(s) FROM results_student_skills(v_ea[1]) s);
  END IF;
  -- (sk2) manual marks count fractionally: 1 + 0.5 of 2, 0.5 + 0 of 2.
  IF (SELECT array_agg(ARRAY[s.skill, s.correct::text, s.percentage::text] ORDER BY s.skill)
        FROM results_student_skills(v_em) s)
     IS DISTINCT FROM ARRAY[ARRAY['Measurement','0.5','25'], ARRAY['Number Systems','1.5','75']] THEN
    RAISE EXCEPTION 'FAIL sk2: %', (SELECT array_agg(s) FROM results_student_skills(v_em) s);
  END IF;
  -- (sk3) school summary: Number Systems at A = 10 of 12 = 83%, 6 students.
  SELECT * INTO r FROM results_skill_summary(v_proj, v_a, '04', 'MPO') WHERE skill = 'Number Systems';
  IF r.school_pct IS DISTINCT FROM 83 OR r.students IS DISTINCT FROM 6 OR r.state_pct IS NULL THEN
    RAISE EXCEPTION 'FAIL sk3: %', r;
  END IF;
  -- (sk4) project-wide: 14 of 16 = 88%, 8 students, no school figure.
  SELECT * INTO r FROM results_skill_summary(v_proj, NULL, '04', 'MPO') WHERE skill = 'Number Systems';
  IF r.state_pct IS DISTINCT FROM 88 OR r.students IS DISTINCT FROM 8 OR r.school_pct IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sk4: %', r;
  END IF;

  -- (bk1) bulk skills: A1's rows match the single-student function, with grade.
  IF (SELECT array_agg(ARRAY[b.skill, b.correct::text, b.total::text, b.grade, b.class_code] ORDER BY b.skill)
        FROM results_bulk_student_skills(v_proj, v_a) b WHERE b.enrollment_id = v_ea[1])
     IS DISTINCT FROM ARRAY[ARRAY['Algebra','1','1','A','04'], ARRAY['Geometry','1','2','A','04'],
                            ARRAY['Number Systems','2','2','A','04']]
     OR (SELECT count(DISTINCT enrollment_id) FROM results_bulk_student_skills(v_proj, v_a)) <> 6 THEN
    RAISE EXCEPTION 'FAIL bk1: %', (SELECT array_agg(b) FROM results_bulk_student_skills(v_proj, v_a) b WHERE b.enrollment_id = v_ea[1]);
  END IF;

  -- (rc1) score combinations.
  IF (SELECT students FROM results_score_combinations(v_proj) WHERE class_code = '04' AND olympiad_code = 'MPO') IS DISTINCT FROM 8
     OR (SELECT students FROM results_score_combinations(v_proj) WHERE class_code = '01' AND olympiad_code = 'MPO') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL rc1: %', (SELECT array_agg(c) FROM results_score_combinations(v_proj) c);
  END IF;
  -- (rc2) registered vs evaluated for school A, Class 4 Maths.
  SELECT count(*) INTO v_reg FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND pe.school_id = v_a AND pe.olympiad_code = 'MPO' AND st.class_code = '04';
  SELECT * INTO r FROM results_registered_vs_evaluated(v_proj) WHERE school_id = v_a AND class_code = '04' AND olympiad_code = 'MPO';
  IF r.registered IS DISTINCT FROM v_reg OR r.evaluated <> 6 OR r.absent <> 0 OR r.pending <> v_reg - 6 OR r.school_name IS NULL THEN
    RAISE EXCEPTION 'FAIL rc2: %', r;
  END IF;

  -- (cr) a correction needs a reason; with one it is recorded before / after.
  SELECT id INTO v_ev FROM result_evaluations WHERE enrollment_id = v_ea[6] AND deleted_at IS NULL;
  v_msg := NULL;
  BEGIN PERFORM results_correct_answer(v_ev, 1, 'A', '  '); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Please give a reason for this correction.' THEN RAISE EXCEPTION 'FAIL cr1: %', v_msg; END IF;
  PERFORM results_correct_answer(v_ev, 1, 'B', 'OMR misread');   -- D -> B, still wrong: score unchanged
  IF NOT EXISTS (SELECT 1 FROM result_corrections WHERE evaluation_id = v_ev AND question_number = 1
                    AND before_value = 'D' AND after_value = 'B' AND reason = 'OMR misread' AND changed_by = auth.uid())
     OR (SELECT total FROM result_scores WHERE enrollment_id = v_ea[6]) <> 1 THEN
    RAISE EXCEPTION 'FAIL cr2: correction not recorded';
  END IF;
  PERFORM results_correct_answer(v_ev, 1, 'D');   -- the 3-argument version still works
  IF (SELECT answers[1] FROM result_evaluations WHERE id = v_ev) IS DISTINCT FROM 'D' THEN RAISE EXCEPTION 'FAIL cr3'; END IF;

  PERFORM set_config('test.paper', v_paper::text, true);
END
$s$;

-- 2. Integrity scan, review, awards (as the manager).
DO $i$
DECLARE
  v_proj uuid := current_setting('test.proj')::uuid;
  v_a    uuid := current_setting('test.a')::uuid;
  v_b    uuid := current_setting('test.b')::uuid;
  v_ea   uuid[] := current_setting('test.ea')::uuid[];
  v_eb   uuid[] := current_setting('test.eb')::uuid[];
  v_res  jsonb;
  v_flag uuid;
  v_n    int;
  v_msg  text;
BEGIN
  -- (in1) the planted identical group of 5 is one 'high' flag listing exactly those 5.
  v_res := results_integrity_scan(v_proj);
  SELECT id INTO v_flag FROM result_integrity_flags
   WHERE project_id = v_proj AND school_id = v_a AND flag_type = 'identical_answers';
  IF v_flag IS NULL
     OR (SELECT severity FROM result_integrity_flags WHERE id = v_flag) <> 'high'
     OR (SELECT (details->>'studentCount')::int FROM result_integrity_flags WHERE id = v_flag) <> 5
     OR (SELECT ARRAY(SELECT jsonb_array_elements_text(details->'enrollmentIds')::uuid ORDER BY 1)
           FROM result_integrity_flags WHERE id = v_flag)
        IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_ea[1:5]) x ORDER BY 1)
     OR (SELECT count(*) FROM result_integrity_flags
          WHERE project_id = v_proj AND flag_type = 'identical_answers') <> 1
     OR (v_res->>'scanId') IS NULL THEN
    RAISE EXCEPTION 'FAIL in1: % / %', v_res, (SELECT array_agg(row_to_json(f)) FROM result_integrity_flags f WHERE project_id = v_proj);
  END IF;
  -- (in2) Verified needs a note.
  v_msg := NULL;
  BEGIN PERFORM results_review_integrity_flag(v_flag, 'verified', ''); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Add a note saying why this flag is Verified.' THEN RAISE EXCEPTION 'FAIL in2: %', v_msg; END IF;

  -- (aw1) awards before any verified flag. National Topper (top 1, national) ties:
  -- both B students; School Topper (top 1 per school) goes to A1..A5 (5-way tie);
  -- B1 / B2 already have National Topper (first matching rule wins).
  INSERT INTO result_award_rules (project_id, award_name, level, rule_type, value, class_code, olympiad_code, sort_order)
  VALUES (v_proj, 'National Topper', 'national', 'top_n', 1, '04', 'MPO', 1),
         (v_proj, 'School Topper',   'school',   'top_n', 1, '04', 'MPO', 2);
  v_res := results_allot_awards(v_proj);
  IF (SELECT array_agg(enrollment_id ORDER BY enrollment_id) FROM result_awards
       WHERE project_id = v_proj AND award_name = 'National Topper' AND source = 'rule')
     IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_eb) x ORDER BY 1) THEN
    RAISE EXCEPTION 'FAIL aw1: tie did not give both students the award: %', v_res;
  END IF;
  IF (SELECT count(*) FROM result_awards WHERE project_id = v_proj AND award_name = 'School Topper') <> 5
     OR (SELECT count(*) FROM result_awards WHERE enrollment_id = v_eb[1]) <> 1
     OR (v_res->>'awarded')::int <> 7 OR jsonb_array_length(v_res->'manualReview') <> 0 THEN
    RAISE EXCEPTION 'FAIL aw2: %', v_res;
  END IF;

  -- A manual award, then verify A's flag and re-scan.
  INSERT INTO result_awards (project_id, enrollment_id, award_name, source, notes)
  VALUES (v_proj, v_ea[6], 'Special Mention', 'manual', 'test');
  PERFORM results_review_integrity_flag(v_flag, 'verified', 'Checked the answer sheets');
  v_res := results_integrity_scan(v_proj);
  -- (in3) the verified flag is kept and not raised again as pending.
  IF (SELECT status FROM result_integrity_flags WHERE id = v_flag) IS DISTINCT FROM 'verified'
     OR (SELECT count(*) FROM result_integrity_flags
          WHERE project_id = v_proj AND flag_type = 'identical_answers') <> 1
     OR (v_res->>'keptReviewed')::int < 1 OR (v_res->>'alreadyReviewed')::int < 1 THEN
    RAISE EXCEPTION 'FAIL in3: %', v_res;
  END IF;

  -- (aw3) a verified flag excludes that school; manual awards stay.
  v_res := results_allot_awards(v_proj);
  IF EXISTS (SELECT 1 FROM result_awards a JOIN result_scores s ON s.enrollment_id = a.enrollment_id
              WHERE a.project_id = v_proj AND a.source = 'rule' AND s.school_id = v_a)
     OR (SELECT count(*) FROM result_awards WHERE project_id = v_proj AND source = 'rule') <> 2
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'manualReview') m WHERE (m->>'schoolId')::uuid = v_a)
     OR NOT EXISTS (SELECT 1 FROM result_awards WHERE enrollment_id = v_ea[6] AND source = 'manual' AND NOT removed) THEN
    RAISE EXCEPTION 'FAIL aw3: %', v_res;
  END IF;
  -- (aw4) managers can't insert rule awards directly.
  v_msg := NULL;
  BEGIN
    INSERT INTO result_awards (project_id, enrollment_id, award_name, source) VALUES (v_proj, v_ea[1], 'Fake', 'rule');
  EXCEPTION WHEN insufficient_privilege THEN v_msg := 'denied'; END;
  IF v_msg IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FAIL aw4: rule award inserted directly'; END IF;
  -- (au) awards are audited.
  IF NOT EXISTS (SELECT 1 FROM result_audit_log WHERE table_name = 'result_awards' AND action = 'DELETE') THEN
    RAISE EXCEPTION 'FAIL au: award changes not audited';
  END IF;

  -- (rf) Review focus 4: a manager calling the superadmin RPCs is refused server-side.
  v_msg := NULL;
  BEGIN PERFORM results_release_schools(v_proj, ARRAY[v_a], 'x'); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Only a superadmin can release results.' THEN RAISE EXCEPTION 'FAIL rf1: %', v_msg; END IF;
  v_msg := NULL;
  BEGIN PERFORM results_unrelease_school(v_proj, v_a); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Only a superadmin can release results.' THEN RAISE EXCEPTION 'FAIL rf2: %', v_msg; END IF;
  v_msg := NULL;
  BEGIN PERFORM results_clear_resend_flag(gen_random_uuid()); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Only a superadmin can release results.' THEN RAISE EXCEPTION 'FAIL rf3: %', v_msg; END IF;
  v_msg := NULL;
  BEGIN PERFORM results_stage_send(v_proj, 'email', ARRAY[v_a], NULL); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Only a superadmin can send results.' THEN RAISE EXCEPTION 'FAIL rf4: %', v_msg; END IF;

  -- (pv) privileges.
  IF has_table_privilege('anon', 'public.result_feedback', 'SELECT')
     OR has_table_privilege('anon', 'public.result_integrity_flags', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL pv1: anon can read new tables';
  END IF;
  IF has_function_privilege('anon', 'public.portal_school_results(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.results_release_schools(uuid,uuid[],text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.results_lock_school_groups(uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL pv2: function privileges';
  END IF;
  v_msg := NULL;
  BEGIN
    INSERT INTO result_feedback (enrollment_id, feedback, model) VALUES (v_ea[1], '{"overall":"x"}', 'm');
  EXCEPTION WHEN insufficient_privilege THEN v_msg := 'denied'; END;
  IF v_msg IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FAIL pv3: authenticated wrote result_feedback'; END IF;
  v_msg := NULL;
  BEGIN
    UPDATE result_integrity_flags SET status = 'dismissed' WHERE id = v_flag;
  EXCEPTION WHEN insufficient_privilege THEN v_msg := 'denied'; END;
  IF v_msg IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FAIL pv4: flag updated directly'; END IF;

  -- Non-managers can't scan or allot.
  IF current_setting('test.other') <> '' THEN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', current_setting('test.other'), 'role', 'authenticated')::text, true);
    v_msg := NULL;
    BEGIN PERFORM results_integrity_scan(v_proj); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    IF v_msg IS DISTINCT FROM 'Only managers can do this.' THEN RAISE EXCEPTION 'FAIL n1: %', v_msg; END IF;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
  END IF;
END
$i$;

-- AI feedback / analysis rows (written by the edge function with service_role in real life).
RESET ROLE;
INSERT INTO result_feedback (enrollment_id, feedback, model)
SELECT x, '{"overall":"Well done","strengths":[],"focus_areas":[],"tips":[],"goals":[]}'::jsonb, 'claude-haiku-5-5'
  FROM unnest(ARRAY[(current_setting('test.ea')::uuid[])[1], (current_setting('test.ea')::uuid[])[6],
                    (current_setting('test.eb')::uuid[])[1]]) AS x;
INSERT INTO result_school_analysis (school_id, project_id, analysis, model)
SELECT x, current_setting('test.proj')::uuid, '{"summary":"x"}'::jsonb, 'claude-haiku-5-5'
  FROM unnest(ARRAY[current_setting('test.a')::uuid, current_setting('test.b')::uuid,
                    NULLIF(current_setting('test.c'), '')::uuid]) AS x
 WHERE x IS NOT NULL;
-- (ab) only one running AI batch per project x school (NULL school = project-wide).
DO $ab$
DECLARE v_msg text;
BEGIN
  INSERT INTO result_ai_batches (project_id, status) VALUES (current_setting('test.proj')::uuid, 'submitted');
  INSERT INTO result_ai_batches (project_id, school_id, status)
  VALUES (current_setting('test.proj')::uuid, current_setting('test.a')::uuid, 'submitted');   -- other scope: fine
  BEGIN
    INSERT INTO result_ai_batches (project_id, status) VALUES (current_setting('test.proj')::uuid, 'submitted');
  EXCEPTION WHEN unique_violation THEN v_msg := 'blocked'; END;
  IF v_msg IS DISTINCT FROM 'blocked' THEN RAISE EXCEPTION 'FAIL ab: two running project-wide batches allowed'; END IF;
END
$ab$;
SET LOCAL ROLE authenticated;

-- 3. Release, portal, staged send, re-score -> Outdated + resend flag (superadmin).
DO $r$
DECLARE
  v_proj  uuid := current_setting('test.proj')::uuid;
  v_a     uuid := current_setting('test.a')::uuid;
  v_b     uuid := current_setting('test.b')::uuid;
  v_ea    uuid[] := current_setting('test.ea')::uuid[];
  v_eb    uuid[] := current_setting('test.eb')::uuid[];
  v_paper uuid := current_setting('test.paper')::uuid;
  v_n     int;
  v_batch uuid;
  v_flag  uuid;
  v_msg   text;
BEGIN
  -- (po1) the portal sees nothing before release.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.portal'), 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM portal_school_results(v_proj)) THEN RAISE EXCEPTION 'FAIL po1: results visible before release'; END IF;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.sa'), 'role', 'authenticated')::text, true);
  -- (re1) release A twice in one call + B: 2 new; again: 0.
  v_n := results_release_schools(v_proj, ARRAY[v_a, v_a, v_b], 'p47 test');
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL re1: released %', v_n; END IF;
  IF results_release_schools(v_proj, ARRAY[v_a], NULL) <> 0 THEN RAISE EXCEPTION 'FAIL re2: re-release counted'; END IF;
  IF (SELECT count(*) FROM result_audit_log WHERE table_name = 'school_result_release' AND action = 'RELEASE'
         AND (after->>'school_id')::uuid IN (v_a, v_b)) <> 2 THEN
    RAISE EXCEPTION 'FAIL re3: release not audited';
  END IF;

  -- (po2) the portal now sees exactly school A's 6 scores.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.portal'), 'role', 'authenticated')::text, true);
  IF (SELECT count(*) FROM portal_school_results(v_proj)) <> 6
     OR EXISTS (SELECT 1 FROM portal_school_results(v_proj) p WHERE p.enrollment_id <> ALL (v_ea)) THEN
    RAISE EXCEPTION 'FAIL po2: portal rows %', (SELECT count(*) FROM portal_school_results(v_proj));
  END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.sa'), 'role', 'authenticated')::text, true);

  -- (se1) stage a test-mode email send for A: one pending item to the test address.
  v_msg := NULL;
  BEGIN PERFORM results_stage_send(v_proj, 'sms', ARRAY[v_a], NULL); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Choose Email or WhatsApp.' THEN RAISE EXCEPTION 'FAIL se0: %', v_msg; END IF;
  v_batch := results_stage_send(v_proj, 'email', ARRAY[v_a], ' qa@example.com ');
  IF (SELECT status FROM result_send_batches WHERE id = v_batch) IS DISTINCT FROM 'staged'
     OR (SELECT test_target FROM result_send_batches WHERE id = v_batch) IS DISTINCT FROM 'qa@example.com'
     OR (SELECT count(*) FROM result_send_items WHERE batch_id = v_batch) <> 1
     OR (SELECT target FROM result_send_items WHERE batch_id = v_batch) IS DISTINCT FROM 'qa@example.com'
     OR (SELECT status FROM result_send_items WHERE batch_id = v_batch) IS DISTINCT FROM 'pending'
     OR (SELECT (payload->>'evaluated')::int FROM result_send_items WHERE batch_id = v_batch) <> 6 THEN
    RAISE EXCEPTION 'FAIL se1: staged batch wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM result_audit_log WHERE table_name = 'result_send_batches' AND row_id = v_batch) THEN
    RAISE EXCEPTION 'FAIL se2: send batch not audited';
  END IF;

  -- (ou) Q4 key D -> A: A1..A5 (answered A) 4 -> 5, B (answered D) 5 -> 4, A6 (C) stays 1.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM result_send_batches) THEN RAISE EXCEPTION 'FAIL rf5: manager can see send batches'; END IF;
  UPDATE questions SET correct_answer = 'A' WHERE paper_id = v_paper AND question_number = 4;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_ea[1]) <> 5 THEN RAISE EXCEPTION 'FAIL ou0: not re-scored'; END IF;
  IF (SELECT outdated FROM result_feedback WHERE enrollment_id = v_ea[1]) IS DISTINCT FROM true
     OR (SELECT outdated FROM result_feedback WHERE enrollment_id = v_eb[1]) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL ou1: changed students'' feedback not outdated';
  END IF;
  IF (SELECT outdated FROM result_feedback WHERE enrollment_id = v_ea[6]) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL ou2: unchanged student''s feedback marked outdated';
  END IF;
  IF (SELECT outdated FROM result_school_analysis WHERE school_id = v_a AND project_id = v_proj) IS DISTINCT FROM true
     OR (SELECT outdated FROM result_school_analysis WHERE school_id = v_b AND project_id = v_proj) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL ou3: school analysis not outdated';
  END IF;
  -- (bk2) only students needing feedback: A6 (fresh feedback) is left out, A1 (outdated) is in.
  IF EXISTS (SELECT 1 FROM results_bulk_student_skills(v_proj, v_a) WHERE enrollment_id = v_ea[6])
     OR NOT EXISTS (SELECT 1 FROM results_bulk_student_skills(v_proj, v_a) WHERE enrollment_id = v_ea[1])
     OR NOT EXISTS (SELECT 1 FROM results_bulk_student_skills(v_proj, v_a, false) WHERE enrollment_id = v_ea[6]) THEN
    RAISE EXCEPTION 'FAIL bk2: needing-feedback filter';
  END IF;
  IF current_setting('test.c') <> ''
     AND (SELECT outdated FROM result_school_analysis WHERE school_id = current_setting('test.c')::uuid AND project_id = v_proj)
         IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL ou4: unrelated school analysis marked outdated';
  END IF;

  -- (cl) Review focus 1: released A got a resend flag; the superadmin clears it.
  SELECT id INTO v_flag FROM result_resend_flags WHERE project_id = v_proj AND school_id = v_a AND cleared_at IS NULL;
  IF v_flag IS NULL THEN RAISE EXCEPTION 'FAIL cl1: no resend flag after a re-score'; END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('test.sa'), 'role', 'authenticated')::text, true);
  IF NOT results_clear_resend_flag(v_flag) THEN RAISE EXCEPTION 'FAIL cl2: clear returned false'; END IF;
  IF (SELECT cleared_by FROM result_resend_flags WHERE id = v_flag) IS DISTINCT FROM current_setting('test.sa')::uuid
     OR results_clear_resend_flag(v_flag) THEN
    RAISE EXCEPTION 'FAIL cl3: clear not recorded / cleared twice';
  END IF;

  -- (un) unrelease B: row gone, copy in the audit log, B can no longer be staged.
  IF results_unrelease_school(v_proj, v_b) <> 1 THEN RAISE EXCEPTION 'FAIL un1'; END IF;
  IF results_unrelease_school(v_proj, v_b) <> 0 THEN RAISE EXCEPTION 'FAIL un2: unreleased twice'; END IF;
  IF NOT EXISTS (SELECT 1 FROM result_audit_log WHERE table_name = 'school_result_release' AND action = 'UNRELEASE'
                    AND (before->>'school_id')::uuid = v_b) THEN
    RAISE EXCEPTION 'FAIL un3: unrelease not audited';
  END IF;
  v_msg := NULL;
  BEGIN PERFORM results_stage_send(v_proj, 'whatsapp', ARRAY[v_b], NULL); EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'Nothing was staged: 1 of the selected schools hasn''t been released yet.' THEN
    RAISE EXCEPTION 'FAIL un4: %', v_msg;
  END IF;
END
$r$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
