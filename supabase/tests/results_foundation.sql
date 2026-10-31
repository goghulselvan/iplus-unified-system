-- Test for supabase/migrations/20261101_results_foundation.sql.
-- Run: supabase db query --linked -f supabase/tests/results_foundation.sql
-- Everything happens inside one transaction that is rolled back, so no data is
-- left behind. Any failed assertion raises an exception; success ends with
-- SELECT 'ALL PASS'. Fixtures are the real active project and the real Slot 1 /
-- Slot 2 templates (read-only references; nothing outside this transaction changes).
BEGIN;

DO $test$
DECLARE
  v_proj  constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_slot1 constant uuid := 'b6e13e39-d7a5-4468-bcde-097402c5cc28';
  v_slot2 constant uuid := '3d2c70e0-7ad5-41c8-9e77-554e1d0560a3';
  v_paper uuid;
  v_q     uuid;
  v_n     int;
  v_t     text;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  -- 1. The 4 tables exist with RLS enabled
  FOREACH v_t IN ARRAY ARRAY['question_papers','questions','result_skill_lists','result_audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                   AND c.relname = v_t AND c.relkind = 'r' AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL 1: table % missing or RLS not enabled', v_t;
    END IF;
  END LOOP;

  -- 2. Leftover tables are gone (question_papers/questions are re-created, so check their old shape instead)
  FOREACH v_t IN ARRAY ARRAY['result_students','olympiad_results','student_reports','student_responses',
                             'student_skill_analysis','analysis_jobs','school_analysis','awards','school_flags'] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL 2: leftover table % still exists', v_t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='question_papers' AND column_name='subject_code') THEN
    RAISE EXCEPTION 'FAIL 2: old question_papers shape still present';
  END IF;
  IF to_regclass('public.school_result_release') IS NULL THEN
    RAISE EXCEPTION 'FAIL 2: school_result_release must be left untouched';
  END IF;

  -- 3. KidsPO check: ('14','MPO') fails, ('03','KidsPO') fails
  BEGIN
    INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
    VALUES (v_proj, '14', 'MPO', v_slot1, 30);
    RAISE EXCEPTION 'FAIL 3a: (14, MPO) was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
    VALUES (v_proj, '03', 'KidsPO', v_slot1, 50);
    RAISE EXCEPTION 'FAIL 3b: (03, KidsPO) was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. Duplicate live paper fails; allowed once the first is soft-deleted
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  VALUES (v_proj, '03', 'MPO', v_slot1, 50) RETURNING id INTO v_paper;
  BEGIN
    INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
    VALUES (v_proj, '03', 'MPO', v_slot1, 50);
    RAISE EXCEPTION 'FAIL 4a: duplicate live paper was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE question_papers SET deleted_at = now() WHERE id = v_paper;
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  VALUES (v_proj, '03', 'MPO', v_slot1, 50) RETURNING id INTO v_paper;   -- must succeed now
  -- the same class/olympiad in the other slot is a different paper
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  VALUES (v_proj, '03', 'MPO', v_slot2, 50);

  -- 5. Answer check: 'E' fails, 'A' and NULL (grace) pass
  BEGIN
    INSERT INTO questions (paper_id, question_number, question_text, correct_answer)
    VALUES (v_paper, 1, 'q1', 'E');
    RAISE EXCEPTION 'FAIL 5a: answer E was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO questions (paper_id, question_number, question_text, correct_answer)
  VALUES (v_paper, 1, 'q1', 'A') RETURNING id INTO v_q;
  INSERT INTO questions (paper_id, question_number, question_text, correct_answer, is_grace)
  VALUES (v_paper, 2, 'q2', NULL, true);
  BEGIN
    INSERT INTO questions (paper_id, question_number, question_text) VALUES (v_paper, 1, 'dup');
    RAISE EXCEPTION 'FAIL 5b: duplicate question number was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO questions (paper_id, question_number, question_text, cognitive_level)
    VALUES (v_paper, 3, 'q3', 'Memorise');
    RAISE EXCEPTION 'FAIL 5c: invalid cognitive level was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. An UPDATE on questions writes exactly one audit row with before/after
  SELECT count(*) INTO v_n FROM result_audit_log WHERE table_name = 'questions' AND row_id = v_q AND action = 'UPDATE';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 6: unexpected pre-existing UPDATE audit rows (%)', v_n; END IF;
  UPDATE questions SET correct_answer = 'B', human_edited = true WHERE id = v_q;
  SELECT count(*) INTO v_n FROM result_audit_log WHERE table_name = 'questions' AND row_id = v_q AND action = 'UPDATE';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 6a: expected 1 UPDATE audit row, got %', v_n; END IF;
  SELECT before, after INTO v_before, v_after FROM result_audit_log
   WHERE table_name = 'questions' AND row_id = v_q AND action = 'UPDATE';
  IF v_before->>'correct_answer' IS DISTINCT FROM 'A' OR v_after->>'correct_answer' IS DISTINCT FROM 'B' THEN
    RAISE EXCEPTION 'FAIL 6b: audit before/after wrong: % / %', v_before->>'correct_answer', v_after->>'correct_answer';
  END IF;
  -- inserts are audited too, and so are papers
  IF NOT EXISTS (SELECT 1 FROM result_audit_log WHERE table_name = 'question_papers' AND row_id = v_paper AND action = 'INSERT') THEN
    RAISE EXCEPTION 'FAIL 6c: paper INSERT not audited';
  END IF;
  -- updated_at is maintained
  IF (SELECT updated_at FROM questions WHERE id = v_q) < (SELECT created_at FROM question_papers WHERE id = v_paper) THEN
    RAISE EXCEPTION 'FAIL 6d: updated_at not maintained';
  END IF;

  -- 7. Cascade: deleting a paper removes its questions
  DELETE FROM question_papers WHERE id = v_paper;
  SELECT count(*) INTO v_n FROM questions WHERE paper_id = v_paper;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 7: questions not cascaded (%)', v_n; END IF;

  -- 8. Skill lists
  SELECT count(*) INTO v_n FROM result_skill_lists WHERE olympiad_code = 'LRPO' AND class_group = 'class_1_2';
  IF v_n < 8 THEN RAISE EXCEPTION 'FAIL 8a: LRPO class_1_2 has % skills (need >= 8)', v_n; END IF;
  BEGIN
    INSERT INTO result_skill_lists (olympiad_code, class_group, skill, sort_order) VALUES ('EPO', 'class_9_12', 'x', 1);
    RAISE EXCEPTION 'FAIL 8b: class_9_12 was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM result_skill_lists WHERE class_group = 'class_9_12') THEN
    RAISE EXCEPTION 'FAIL 8c: class_9_12 rows exist';
  END IF;
  -- every combination the app can ask for has a list
  IF EXISTS (
    SELECT 1 FROM (VALUES ('EPO'),('MPO'),('SPO'),('GKSSPO'),('LRPO')) o(code)
    CROSS JOIN (VALUES ('class_1_2'),('class_3_5'),('class_6_8')) g(grp)
    WHERE NOT EXISTS (SELECT 1 FROM result_skill_lists s WHERE s.olympiad_code = o.code AND s.class_group = g.grp)
  ) THEN RAISE EXCEPTION 'FAIL 8d: a regular olympiad/class group has no skills'; END IF;
  IF NOT EXISTS (SELECT 1 FROM result_skill_lists WHERE olympiad_code = 'KidsPO' AND class_group = 'lkg_ukg') THEN
    RAISE EXCEPTION 'FAIL 8e: KidsPO/lkg_ukg has no skills';
  END IF;

  -- 9. Access policies exist and are manager/superadmin only
  FOREACH v_t IN ARRAY ARRAY['question_papers','questions'] LOOP
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname='public' AND tablename=v_t
      AND (qual ILIKE '%is_manager_or_superadmin%' OR with_check ILIKE '%is_manager_or_superadmin%');
    IF v_n < 4 THEN RAISE EXCEPTION 'FAIL 9a: % has % role-checked policies (need 4)', v_t, v_n; END IF;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['result_skill_lists','result_audit_log'] LOOP
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname='public' AND tablename=v_t;
    IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=v_t
                               AND cmd='SELECT' AND qual ILIKE '%is_manager_or_superadmin%') THEN
      RAISE EXCEPTION 'FAIL 9b: % must have exactly one SELECT policy gated on is_manager_or_superadmin', v_t;
    END IF;
  END LOOP;
  -- 10. The live "Remove from project" check still works and no longer reads result_students
  IF (SELECT public.school_removal_blockers((SELECT id FROM schools LIMIT 1), v_proj)) IS NULL THEN
    RAISE EXCEPTION 'FAIL 10a: school_removal_blockers returned NULL';
  END IF;
  IF pg_get_functiondef('public.school_removal_blockers(uuid,uuid)'::regprocedure) ILIKE '%result_students%' THEN
    RAISE EXCEPTION 'FAIL 10b: school_removal_blockers still references result_students';
  END IF;

  -- 11. The 13 dormant functions are gone
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
      'audit_student_results_access','get_evaluated_students_count','get_rankings','get_result_schools',
      'get_results_paginated','get_school_class_subject_stats','get_school_evaluated_count',
      'get_school_registration_evaluation_stats','get_school_statistics','get_school_student_counts',
      'strip_student_names_from_feedback','trg_sanitize_student_report','trg_sanitize_student_skill')) THEN
    RAISE EXCEPTION 'FAIL 11: a dormant results function still exists';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
