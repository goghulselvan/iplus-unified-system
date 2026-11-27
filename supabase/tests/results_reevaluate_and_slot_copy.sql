-- Test for supabase/migrations/20261127_results_reevaluate_and_slot_copy.sql.
-- Run after that migration is applied:
--   supabase db query --linked -f supabase/tests/results_reevaluate_and_slot_copy.sql
-- One transaction, rolled back: nothing is left behind. Success ends with 'ALL PASS'.
--
-- Story tested: a school sat Slot 2 but the CRM said Slot 1. Its OMR file was uploaded
-- (marked against Slot 1). Staff correct the slot to Slot 2; a superadmin re-evaluates.
-- Also: "Same questions for all slots" copies the Slot 1 paper to Slot 2.
BEGIN;

DO $fx$
DECLARE
  v_proj constant uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
  v_school uuid; v_class text; v_oly text; v_s1 uuid; v_s2 uuid; v_cur uuid;
  v_e uuid[]; v_r text[]; v_mgr uuid; v_sa uuid;
BEGIN
  SELECT id INTO v_s1 FROM exam_slot_templates WHERE project_id = v_proj AND slot_name = 'Slot 1';
  SELECT id INTO v_s2 FROM exam_slot_templates WHERE project_id = v_proj AND slot_name = 'Slot 2';
  SELECT pe.school_id, st.class_code, pe.olympiad_code INTO v_school, v_class, v_oly
    FROM portal_student_enrollments pe JOIN portal_registered_students st ON st.id = pe.student_id
   WHERE pe.project_id = v_proj AND st.class_code NOT IN ('14','15','01','02') AND pe.registration_number IS NOT NULL
     AND (SELECT count(DISTINCT es.slot_template_id) FROM exam_slots es
           WHERE es.school_id = pe.school_id AND es.project_id = v_proj AND es.slot_template_id IS NOT NULL) = 1
   GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY count(*) DESC, 1, 2, 3 LIMIT 1;
  SELECT array_agg(x.id ORDER BY x.reg), array_agg(public.results_digits(x.reg) ORDER BY x.reg) INTO v_e, v_r
    FROM (SELECT pe.id, pe.registration_number reg FROM portal_student_enrollments pe
            JOIN portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_proj AND pe.school_id = v_school AND st.class_code = v_class
             AND pe.olympiad_code = v_oly AND pe.registration_number IS NOT NULL
           ORDER BY pe.registration_number LIMIT 2) x;
  SELECT user_id INTO v_mgr FROM profiles WHERE role::text = 'manager' ORDER BY created_at, user_id LIMIT 1;
  SELECT user_id INTO v_sa FROM profiles WHERE role::text = 'superadmin' ORDER BY created_at, user_id LIMIT 1;
  IF v_school IS NULL OR v_mgr IS NULL OR v_sa IS NULL OR v_s1 IS NULL OR v_s2 IS NULL THEN RAISE EXCEPTION 'FIXTURE missing'; END IF;
  IF EXISTS (SELECT 1 FROM question_papers WHERE project_id = v_proj AND class_code = v_class AND olympiad_code = v_oly AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FIXTURE: papers already exist for this class x olympiad';
  END IF;

  -- The CRM (wrongly) says Slot 1 for this school.
  UPDATE exam_slots SET slot_template_id = v_s1 WHERE school_id = v_school AND project_id = v_proj AND slot_template_id IS NOT NULL;

  PERFORM set_config('test.proj', v_proj::text, true);
  PERFORM set_config('test.school', v_school::text, true);
  PERFORM set_config('test.class', v_class, true);
  PERFORM set_config('test.oly', v_oly, true);
  PERFORM set_config('test.s1', v_s1::text, true);
  PERFORM set_config('test.s2', v_s2::text, true);
  PERFORM set_config('test.e1', v_e[1]::text, true);
  PERFORM set_config('test.e2', v_e[2]::text, true);
  PERFORM set_config('test.r1', v_r[1], true);
  PERFORM set_config('test.r2', v_r[2], true);
  PERFORM set_config('test.mgr', v_mgr::text, true);
  PERFORM set_config('test.sa', v_sa::text, true);
END
$fx$;

-- As a manager: build the Slot 1 paper with a full key, upload the school's file.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.mgr'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $a$
DECLARE
  v_proj uuid := current_setting('test.proj')::uuid;
  v_class text := current_setting('test.class');
  v_oly text := current_setting('test.oly');
  v_s1 uuid := current_setting('test.s1')::uuid;
  v_nq int; v_p1 uuid; v_res jsonb; v_all jsonb;
BEGIN
  SELECT question_count INTO v_nq FROM classes WHERE code = v_class;
  INSERT INTO question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  VALUES (v_proj, v_class, v_oly, v_s1, v_nq) RETURNING id INTO v_p1;
  INSERT INTO questions (paper_id, question_number, question_text, correct_answer, key_answer, check_status)
  SELECT v_p1, n, 'Q' || n, 'A', 'A', 'key_only' FROM generate_series(1, v_nq) n;

  v_all := (SELECT jsonb_agg('A'::text) FROM generate_series(1, v_nq));
  v_res := results_upload_omr(v_proj, 'school.xlsx', jsonb_build_array(
    jsonb_build_object('row', 2, 'reg', current_setting('test.r1'), 'values', v_all),
    jsonb_build_object('row', 3, 'reg', current_setting('test.r2'), 'values', v_all)), false);
  IF (v_res ->> 'saved')::int <> 2 THEN RAISE EXCEPTION 'upload: %', v_res; END IF;
  IF (SELECT count(*) FROM result_scores WHERE paper_id = v_p1) <> 2 THEN RAISE EXCEPTION 'not marked on Slot 1'; END IF;

  -- A manager cannot re-evaluate.
  BEGIN
    PERFORM results_reevaluate_school(v_proj, current_setting('test.school')::uuid, true);
    RAISE EXCEPTION 'manager was allowed to re-evaluate';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Only a superadmin can re-evaluate a school.' THEN RAISE; END IF;
  END;

  -- Copy to all slots (manager allowed): dry run then run.
  v_res := results_copy_slot_papers(v_proj, v_s1, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res -> 'items') i
                  WHERE i ->> 'classCode' = v_class AND i ->> 'olympiadCode' = v_oly AND i ->> 'toSlot' = 'Slot 2'
                    AND NOT (i ->> 'targetExists')::boolean) THEN
    RAISE EXCEPTION 'copy dry run: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM question_papers WHERE project_id = v_proj AND class_code = v_class AND olympiad_code = v_oly
               AND slot_template_id <> v_s1) THEN
    RAISE EXCEPTION 'copy dry run created a paper';
  END IF;
  PERFORM set_config('test.p1', v_p1::text, true);
END
$a$;

-- Staff correct the school's slot to Slot 2 (as postgres), then the superadmin re-evaluates.
RESET ROLE;
UPDATE exam_slots SET slot_template_id = current_setting('test.s2')::uuid
 WHERE school_id = current_setting('test.school')::uuid AND project_id = current_setting('test.proj')::uuid
   AND slot_template_id IS NOT NULL;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.sa'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $b$
DECLARE
  v_proj uuid := current_setting('test.proj')::uuid;
  v_school uuid := current_setting('test.school')::uuid;
  v_class text := current_setting('test.class');
  v_oly text := current_setting('test.oly');
  v_s1 uuid := current_setting('test.s1')::uuid;
  v_s2 uuid := current_setting('test.s2')::uuid;
  v_p1 uuid := current_setting('test.p1')::uuid;
  v_e1 uuid := current_setting('test.e1')::uuid;
  v_res jsonb; v_p2 uuid; v_nq int;
BEGIN
  -- Preview: 2 students move Slot 1 -> Slot 2; no Slot 2 paper yet.
  v_res := results_reevaluate_school(v_proj, v_school, true);
  IF (v_res ->> 'count')::int <> 2 OR v_res ->> 'slotName' <> 'Slot 2'
     OR (v_res #>> '{groups,0,paperExists}')::boolean THEN
    RAISE EXCEPTION 'reevaluate dry run: %', v_res;
  END IF;

  -- Run: moved onto an empty Slot 2 paper -> waiting (no Slot 2 key yet).
  v_res := results_reevaluate_school(v_proj, v_school, false);
  IF (v_res ->> 'moved')::int <> 2 THEN RAISE EXCEPTION 'reevaluate: %', v_res; END IF;
  SELECT id INTO v_p2 FROM question_papers WHERE project_id = v_proj AND class_code = v_class
     AND olympiad_code = v_oly AND slot_template_id = v_s2 AND deleted_at IS NULL;
  IF v_p2 IS NULL THEN RAISE EXCEPTION 'Slot 2 paper not created'; END IF;
  IF (SELECT paper_id FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL) <> v_p2 THEN
    RAISE EXCEPTION 'answers not moved to Slot 2';
  END IF;
  IF (SELECT answers FROM result_evaluations WHERE enrollment_id = v_e1 AND deleted_at IS NULL)
     IS DISTINCT FROM (SELECT answers FROM result_evaluations WHERE enrollment_id = v_e1 AND paper_id = v_p1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'answers changed while moving';
  END IF;
  IF EXISTS (SELECT 1 FROM result_scores WHERE enrollment_id = v_e1) THEN RAISE EXCEPTION 'marked without a Slot 2 key'; END IF;

  -- Same questions for all slots: copy Slot 1 -> Slot 2; the waiting students are marked.
  v_res := results_copy_slot_papers(v_proj, v_s1, false);
  IF (v_res ->> 'copied')::int < 1 THEN RAISE EXCEPTION 'copy: %', v_res; END IF;
  SELECT total_questions INTO v_nq FROM question_papers WHERE id = v_p1;
  IF (SELECT count(*) FROM questions WHERE paper_id = v_p2 AND correct_answer = 'A' AND key_answer = 'A') <> v_nq THEN
    RAISE EXCEPTION 'questions not copied to Slot 2';
  END IF;
  IF (SELECT count(*) FROM result_scores WHERE paper_id = v_p2) <> 2 THEN RAISE EXCEPTION 'not marked after the copy'; END IF;
  IF (SELECT total FROM result_scores WHERE enrollment_id = v_e1) <> v_nq THEN RAISE EXCEPTION 'wrong mark after the copy'; END IF;

  -- Nothing left to move now.
  v_res := results_reevaluate_school(v_proj, v_school, true);
  IF (v_res ->> 'count')::int <> 0 THEN RAISE EXCEPTION 'second check should find nothing: %', v_res; END IF;
END
$b$;

ROLLBACK;
SELECT 'ALL PASS' AS result;
