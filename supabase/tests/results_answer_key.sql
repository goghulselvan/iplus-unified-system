-- Test for supabase/migrations/20261107_results_answer_key.sql.
-- Run (after the migration is applied):
--   supabase db query --linked -f supabase/tests/results_answer_key.sql
-- Everything happens inside one transaction that is rolled back, so no data is left
-- behind. Any failed assertion raises an exception; success ends with SELECT 'ALL PASS'.
--
-- Fixtures: the 2026 project (dd5de83d-...), its first slot template with a free
-- class x olympiad combination (no live paper), and one real enrolment that has no
-- live result. The test paper, questions and one result are created inside the
-- transaction. Runs as the CLI's postgres role.
BEGIN;

DO $test$
DECLARE
  v_proj  constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_slot  uuid;
  v_class text;
  v_olym  text;
  v_paper uuid;
  v_enr   uuid;
  v_t     text;
  v_total numeric;
  v_n     int;
BEGIN
  -- 1. The 14 new columns exist; check_status is NOT NULL with default 'unchecked'.
  FOREACH v_t IN ARRAY ARRAY['option_a','option_b','option_c','option_d','key_answer','ai_answer','ai_reason',
                             'recheck_answer','recheck_confidence','recheck_reason','rechecked_at',
                             'figure_page','figure_box','check_status'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = v_t) THEN
      RAISE EXCEPTION 'FAIL 1: column questions.% missing', v_t;
    END IF;
  END LOOP;
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'check_status') <> 'NO' THEN
    RAISE EXCEPTION 'FAIL 1: check_status must be NOT NULL';
  END IF;

  -- Fixtures: a free class x olympiad on a slot of the 2026 project.
  SELECT s.id, c.code, o.code INTO v_slot, v_class, v_olym
    FROM exam_slot_templates s
   CROSS JOIN (VALUES ('01'),('02'),('03'),('04'),('05'),('06'),('07'),('08')) AS c(code)
   CROSS JOIN (VALUES ('EPO'),('MPO'),('SPO'),('GKSSPO'),('LRPO')) AS o(code)
   WHERE s.project_id = v_proj
     AND NOT EXISTS (SELECT 1 FROM question_papers qp
                      WHERE qp.project_id = v_proj AND qp.class_code = c.code
                        AND qp.olympiad_code = o.code AND qp.slot_template_id = s.id
                        AND qp.deleted_at IS NULL)
   ORDER BY s.slot_name, c.code, o.code
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no free class/olympiad/slot combination'; END IF;

  SELECT pe.id INTO v_enr
    FROM portal_student_enrollments pe
   WHERE pe.project_id = v_proj AND pe.registration_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM result_evaluations e WHERE e.enrollment_id = pe.id AND e.deleted_at IS NULL)
   ORDER BY pe.id
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE: no enrolment without a live result'; END IF;

  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  VALUES (v_proj, v_class, v_olym, v_slot, 2) RETURNING id INTO v_paper;
  INSERT INTO questions (paper_id, question_number, question_text, correct_answer, skill_category)
  VALUES (v_paper, 1, 'q1', 'A', 's'), (v_paper, 2, 'q2', 'B', 's');

  -- 2. Defaults: new columns NULL, check_status 'unchecked'.
  IF EXISTS (SELECT 1 FROM questions WHERE paper_id = v_paper
              AND (check_status <> 'unchecked' OR key_answer IS NOT NULL OR ai_answer IS NOT NULL
                   OR figure_box IS NOT NULL OR option_a IS NOT NULL)) THEN
    RAISE EXCEPTION 'FAIL 2: new columns have unexpected defaults';
  END IF;

  -- 3. Constraints reject bad values.
  BEGIN UPDATE questions SET key_answer = 'E' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3a: key_answer E accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET ai_answer = 'a' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3b: ai_answer a accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET recheck_answer = 'X' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3c: recheck_answer X accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET recheck_confidence = 1.5 WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3d: recheck_confidence 1.5 accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET recheck_confidence = -0.1 WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3e: recheck_confidence -0.1 accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET check_status = 'maybe' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3f: check_status maybe accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET check_status = NULL WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3g: check_status NULL accepted'; EXCEPTION WHEN not_null_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_page = 0 WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3h: figure_page 0 accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_box = '{"x":1.5,"y":0,"w":0.5,"h":0.5}' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3i: figure_box x 1.5 accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_box = '{"x":0,"y":0,"w":0.5}' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3j: figure_box without h accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_box = '{"x":"0","y":0,"w":0.5,"h":0.5}' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3k: figure_box with a string x accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_box = '[0,0,1,1]' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3l: figure_box array accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE questions SET figure_box = '{"x":0,"y":0,"w":0,"h":0.5}' WHERE paper_id = v_paper AND question_number = 1;
        RAISE EXCEPTION 'FAIL 3m: figure_box zero width accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- valid values pass
  FOREACH v_t IN ARRAY ARRAY['unchecked','confirmed','key_only','mismatch','mismatch_strong','resolved'] LOOP
    UPDATE questions SET check_status = v_t WHERE paper_id = v_paper AND question_number = 1;
  END LOOP;
  UPDATE questions SET figure_page = 1, figure_box = '{"x":0,"y":0.25,"w":1,"h":0.2}',
                       recheck_confidence = 0.9, option_a = ''
   WHERE paper_id = v_paper AND question_number = 1;

  -- 4. A result on the paper, scored once: both answers right = 2.
  INSERT INTO result_evaluations (enrollment_id, paper_id, status, answers)
  VALUES (v_enr, v_paper, 'evaluated', ARRAY['A','B']);
  PERFORM public.results_rescore_paper_core(v_paper);
  SELECT total INTO v_total FROM result_scores WHERE enrollment_id = v_enr;
  IF v_total IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL 4: expected score 2, got %', v_total; END IF;

  -- Tamper with the stored score so any re-score is visible.
  UPDATE result_scores SET total = 0 WHERE enrollment_id = v_enr;

  -- 5. Writing ONLY the new columns (update and upsert) does not re-score.
  UPDATE questions
     SET option_a = 'cat', option_b = 'dog', option_c = '', option_d = 'cow',
         key_answer = 'A', ai_answer = 'C', ai_reason = 'r', recheck_answer = 'A',
         recheck_confidence = 0.95, recheck_reason = 'rr', rechecked_at = now(),
         figure_page = 2, figure_box = '{"x":0.1,"y":0.1,"w":0.5,"h":0.3}', check_status = 'confirmed'
   WHERE paper_id = v_paper;
  INSERT INTO questions (paper_id, question_number, recheck_answer, recheck_confidence, check_status)
  VALUES (v_paper, 1, 'B', 0.92, 'mismatch_strong'), (v_paper, 2, 'B', 0.5, 'confirmed')
  ON CONFLICT (paper_id, question_number) DO UPDATE
     SET recheck_answer = EXCLUDED.recheck_answer, recheck_confidence = EXCLUDED.recheck_confidence,
         check_status = EXCLUDED.check_status;
  -- same correct_answer written again is not a change either
  UPDATE questions SET correct_answer = correct_answer, check_status = 'resolved' WHERE paper_id = v_paper;
  SELECT total INTO v_total FROM result_scores WHERE enrollment_id = v_enr;
  IF v_total IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL 5: writing only the new columns re-scored the paper (score %)', v_total;
  END IF;

  -- 6. Changing correct_answer still re-scores (q1 now C, student answered A -> 1).
  UPDATE questions SET correct_answer = 'C' WHERE paper_id = v_paper AND question_number = 1;
  SELECT total INTO v_total FROM result_scores WHERE enrollment_id = v_enr;
  IF v_total IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL 6: correct_answer change did not re-score (expected 1, got %)', v_total;
  END IF;

  -- 7. is_grace still re-scores (q1 grace -> 2).
  UPDATE questions SET is_grace = true WHERE paper_id = v_paper AND question_number = 1;
  SELECT total INTO v_total FROM result_scores WHERE enrollment_id = v_enr;
  IF v_total IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL 7: is_grace change did not re-score (expected 2, got %)', v_total;
  END IF;

  -- 8. The audit trail records the new columns.
  SELECT count(*) INTO v_n FROM result_audit_log
   WHERE table_name = 'questions' AND action = 'UPDATE'
     AND row_id IN (SELECT id FROM questions WHERE paper_id = v_paper)
     AND after ? 'key_answer' AND after ->> 'check_status' IS NOT NULL;
  IF v_n = 0 THEN RAISE EXCEPTION 'FAIL 8: audit log does not carry the new columns'; END IF;
END
$test$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
