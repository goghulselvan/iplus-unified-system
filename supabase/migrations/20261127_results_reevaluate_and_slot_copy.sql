-- Results: (1) re-evaluate a school after its exam slot is corrected (superadmin only);
-- (2) copy every paper of one slot to all other slots (same questions on every slot).
--
-- A school's students are marked against the paper of the school's exam slot at upload
-- time. If the slot was wrong in the CRM (e.g. the school sat Slot 2 but the CRM said
-- Slot 1) and is corrected later, this moves every live result of the school (answers,
-- marks or absent) onto the paper of the school's CURRENT slot, keeping the stored
-- answers, and re-marks both papers. Missing papers are created empty (same question
-- count); students then wait for that paper's answer key like any other upload.
--
-- Each moved result is replaced the same way an upload replaces one: the old row is
-- soft-deleted (restorable from the Students page for 30 days) and an identical row is
-- inserted on the new paper. No other data is changed.
BEGIN;

CREATE FUNCTION public.results_reevaluate_school(p_project_id uuid, p_school_id uuid, p_dry_run boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_dry    boolean := COALESCE(p_dry_run, true);
  v_nslots int;
  v_slot   uuid;
  v_slot_name text;
  v_groups jsonb;
  v_count  int;
  v_key    bigint;
  v_pid    uuid;
  v_moved  int;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can re-evaluate a school.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id AND is_active) THEN
    RAISE EXCEPTION 'Results can only be changed for an active olympiad project. Pick the project again.';
  END IF;

  SELECT count(DISTINCT es.slot_template_id)::int, min(es.slot_template_id::text)::uuid
    INTO v_nslots, v_slot
    FROM public.exam_slots es
   WHERE es.school_id = p_school_id AND es.project_id = p_project_id AND es.slot_template_id IS NOT NULL;
  IF v_nslots = 0 THEN
    RAISE EXCEPTION 'This school has no exam slot set in the CRM. Set its slot first, then re-evaluate.';
  ELSIF v_nslots > 1 THEN
    RAISE EXCEPTION 'This school has more than one exam slot set in the CRM. Keep only the slot it sat, then re-evaluate.';
  END IF;
  SELECT slot_name INTO v_slot_name FROM public.exam_slot_templates WHERE id = v_slot;

  -- Live results of this school's students that sit on another slot's paper.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_move_rows (
    ev_id uuid, enrollment_id uuid, old_paper uuid, new_paper uuid,
    class_code text, olympiad_code text, old_slot text, total_questions int
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_move_rows;
  INSERT INTO pg_temp.results_move_rows
  SELECT ev.id, ev.enrollment_id, qp.id,
         (SELECT np.id FROM public.question_papers np
           WHERE np.project_id = p_project_id AND np.class_code = qp.class_code
             AND np.olympiad_code = qp.olympiad_code AND np.slot_template_id = v_slot
             AND np.deleted_at IS NULL),
         qp.class_code, qp.olympiad_code, t.slot_name, qp.total_questions
    FROM public.result_evaluations ev
    JOIN public.portal_student_enrollments pe ON pe.id = ev.enrollment_id
    JOIN public.question_papers qp ON qp.id = ev.paper_id
    LEFT JOIN public.exam_slot_templates t ON t.id = qp.slot_template_id
   WHERE ev.deleted_at IS NULL
     AND pe.project_id = p_project_id
     AND pe.school_id = p_school_id
     AND qp.slot_template_id <> v_slot;

  IF EXISTS (SELECT 1 FROM pg_temp.results_move_rows m
               JOIN public.question_papers np ON np.id = m.new_paper
              WHERE np.total_questions <> m.total_questions) THEN
    RAISE EXCEPTION 'A % paper has a different number of questions from the paper these answers were marked on, so the answers can''t be moved. Check the question counts on the Question Papers page.', v_slot_name;
  END IF;

  SELECT count(*)::int,
         COALESCE(jsonb_agg(g ORDER BY g ->> 'classCode', g ->> 'olympiadCode'), '[]'::jsonb)
    INTO v_count, v_groups
    FROM (
      SELECT jsonb_build_object(
               'classCode', m.class_code,
               'className', COALESCE(c.display_name, 'Class ' || m.class_code),
               'olympiadCode', m.olympiad_code,
               'olympiad', public.results_olympiad_label(m.olympiad_code),
               'fromSlot', m.old_slot,
               'toSlot', v_slot_name,
               'count', count(*),
               'paperExists', min(m.new_paper::text) IS NOT NULL,
               'keyReady', min(m.new_paper::text) IS NOT NULL
                           AND COALESCE(public.results_paper_key_finished(min(m.new_paper::text)::uuid), false)) AS g
        FROM pg_temp.results_move_rows m
        LEFT JOIN public.classes c ON c.code = m.class_code
       GROUP BY m.class_code, c.display_name, m.olympiad_code, m.old_slot
    ) x;
  SELECT count(*)::int INTO v_count FROM pg_temp.results_move_rows;

  IF v_dry OR v_count = 0 THEN
    TRUNCATE pg_temp.results_move_rows;
    RETURN jsonb_build_object('ok', true, 'dryRun', v_dry, 'slotName', v_slot_name, 'count', v_count, 'groups', v_groups, 'moved', 0);
  END IF;

  -- Lock every group touched, in key order (same rule as every results writer).
  FOR v_key IN
    SELECT DISTINCT public.results_group_key(p_project_id, m.class_code, m.olympiad_code)
      FROM pg_temp.results_move_rows m ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  -- Missing papers on the school's slot: create them empty, same question count.
  INSERT INTO public.question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  SELECT DISTINCT p_project_id, m.class_code, m.olympiad_code, v_slot, m.total_questions
    FROM pg_temp.results_move_rows m
   WHERE m.new_paper IS NULL
  ON CONFLICT (project_id, class_code, olympiad_code, slot_template_id) WHERE deleted_at IS NULL DO NOTHING;
  UPDATE pg_temp.results_move_rows m
     SET new_paper = np.id
    FROM public.question_papers np
   WHERE np.project_id = p_project_id AND np.class_code = m.class_code
     AND np.olympiad_code = m.olympiad_code AND np.slot_template_id = v_slot AND np.deleted_at IS NULL;

  PERFORM 1 FROM public.question_papers qp
   WHERE qp.id IN (SELECT old_paper FROM pg_temp.results_move_rows UNION SELECT new_paper FROM pg_temp.results_move_rows)
   ORDER BY qp.id FOR NO KEY UPDATE;

  BEGIN
    UPDATE public.result_evaluations ev
       SET deleted_at = now()
      FROM pg_temp.results_move_rows m
     WHERE ev.id = m.ev_id AND ev.deleted_at IS NULL;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved <> v_count THEN
      RAISE EXCEPTION 'Someone else just changed one of these students'' results. Nothing was changed; please try again.';
    END IF;

    INSERT INTO public.result_evaluations (enrollment_id, paper_id, status, answers, marks, batch_id)
    SELECT ev.enrollment_id, m.new_paper, ev.status, ev.answers, ev.marks, ev.batch_id
      FROM pg_temp.results_move_rows m
      JOIN public.result_evaluations ev ON ev.id = m.ev_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed one of these students'' results. Nothing was changed; please try again.';
  END;

  FOR v_pid IN
    SELECT qp.id
      FROM (SELECT old_paper AS id FROM pg_temp.results_move_rows UNION SELECT new_paper FROM pg_temp.results_move_rows) x
      JOIN public.question_papers qp ON qp.id = x.id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_pid);
  END LOOP;
  TRUNCATE pg_temp.results_move_rows;

  RETURN jsonb_build_object('ok', true, 'dryRun', false, 'slotName', v_slot_name, 'count', v_count, 'groups', v_groups, 'moved', v_moved);
END
$$;

REVOKE ALL ON FUNCTION public.results_reevaluate_school(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.results_reevaluate_school(uuid, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Copy every paper of one slot to the same class x subject on every other slot of the
-- project ("all slots have the same questions"). Managers and superadmins. Questions,
-- answer key, AI cross-check and flag decisions are copied as they are; missing target
-- papers are created; the PDF link and Ready/Draft status follow the source. Students
-- already uploaded on a target paper are marked again by the question triggers.
-- A target with a different question count is skipped and reported.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.results_copy_slot_papers(p_project_id uuid, p_from_slot uuid, p_dry_run boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_dry   boolean := COALESCE(p_dry_run, true);
  v_items jsonb;
  v_key   bigint;
  r       record;
  v_tgt   uuid;
  v_done  int := 0;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id AND is_active) THEN
    RAISE EXCEPTION 'Papers can only be copied in an active olympiad project. Pick the project again.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_slot_templates WHERE id = p_from_slot AND project_id = p_project_id) THEN
    RAISE EXCEPTION 'That slot is not part of this project.';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS results_copy_plan (
    src uuid, class_code text, olympiad_code text, total int, nq int,
    to_slot uuid, to_slot_name text, tgt uuid, tgt_total int, tgt_nq int, tgt_results int
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_copy_plan;
  INSERT INTO pg_temp.results_copy_plan
  SELECT sp.id, sp.class_code, sp.olympiad_code, sp.total_questions,
         (SELECT count(*) FROM public.questions q WHERE q.paper_id = sp.id)::int,
         t.id, t.slot_name, tp.id, tp.total_questions,
         (SELECT count(*) FROM public.questions q WHERE q.paper_id = tp.id)::int,
         (SELECT count(*) FROM public.result_evaluations e WHERE e.paper_id = tp.id AND e.deleted_at IS NULL)::int
    FROM public.question_papers sp
    JOIN public.exam_slot_templates t ON t.project_id = p_project_id AND t.id <> p_from_slot
    LEFT JOIN public.question_papers tp
           ON tp.project_id = p_project_id AND tp.class_code = sp.class_code
          AND tp.olympiad_code = sp.olympiad_code AND tp.slot_template_id = t.id AND tp.deleted_at IS NULL
   WHERE sp.project_id = p_project_id AND sp.slot_template_id = p_from_slot AND sp.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.paper_id = sp.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'classCode', c.class_code,
           'className', COALESCE(cl.display_name, 'Class ' || c.class_code),
           'olympiadCode', c.olympiad_code,
           'olympiad', public.results_olympiad_label(c.olympiad_code),
           'toSlot', c.to_slot_name,
           'questions', c.nq,
           'targetExists', c.tgt IS NOT NULL,
           'targetQuestions', COALESCE(c.tgt_nq, 0),
           'targetStudents', COALESCE(c.tgt_results, 0),
           'problem', CASE WHEN c.tgt IS NOT NULL AND c.tgt_total <> c.total
                           THEN format('The %s paper has %s questions but the source has %s, so it was skipped', c.to_slot_name, c.tgt_total, c.total) END)
         ORDER BY c.class_code, c.olympiad_code, c.to_slot_name), '[]'::jsonb)
    INTO v_items
    FROM pg_temp.results_copy_plan c
    LEFT JOIN public.classes cl ON cl.code = c.class_code;

  IF v_dry THEN
    TRUNCATE pg_temp.results_copy_plan;
    RETURN jsonb_build_object('ok', true, 'dryRun', true, 'items', v_items, 'copied', 0);
  END IF;

  FOR v_key IN
    SELECT DISTINCT public.results_group_key(p_project_id, c.class_code, c.olympiad_code)
      FROM pg_temp.results_copy_plan c ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  FOR r IN
    SELECT * FROM pg_temp.results_copy_plan c
     WHERE c.tgt IS NULL OR c.tgt_total = c.total
     ORDER BY public.results_group_key(p_project_id, c.class_code, c.olympiad_code), c.class_code, c.olympiad_code, c.to_slot_name
  LOOP
    v_tgt := r.tgt;
    IF v_tgt IS NULL THEN
      INSERT INTO public.question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
      VALUES (p_project_id, r.class_code, r.olympiad_code, r.to_slot, r.total)
      ON CONFLICT (project_id, class_code, olympiad_code, slot_template_id) WHERE deleted_at IS NULL DO NOTHING
      RETURNING id INTO v_tgt;
      IF v_tgt IS NULL THEN
        SELECT id INTO v_tgt FROM public.question_papers
         WHERE project_id = p_project_id AND class_code = r.class_code AND olympiad_code = r.olympiad_code
           AND slot_template_id = r.to_slot AND deleted_at IS NULL;
      END IF;
    END IF;

    INSERT INTO public.questions AS t
           (paper_id, question_number, question_text, has_figure, correct_answer, is_grace, skill_category,
            skill_description, nep_skill_mapping, cognitive_level, ai_confidence, human_edited,
            option_a, option_b, option_c, option_d, key_answer, ai_answer, ai_reason,
            recheck_answer, recheck_confidence, recheck_reason, rechecked_at, figure_page, figure_box, check_status)
    SELECT v_tgt, q.question_number, q.question_text, q.has_figure, q.correct_answer, q.is_grace, q.skill_category,
           q.skill_description, q.nep_skill_mapping, q.cognitive_level, q.ai_confidence, q.human_edited,
           q.option_a, q.option_b, q.option_c, q.option_d, q.key_answer, q.ai_answer, q.ai_reason,
           q.recheck_answer, q.recheck_confidence, q.recheck_reason, q.rechecked_at, q.figure_page, q.figure_box, q.check_status
      FROM public.questions q WHERE q.paper_id = r.src
    ON CONFLICT (paper_id, question_number) DO UPDATE SET
      question_text = EXCLUDED.question_text, has_figure = EXCLUDED.has_figure,
      correct_answer = EXCLUDED.correct_answer, is_grace = EXCLUDED.is_grace,
      skill_category = EXCLUDED.skill_category, skill_description = EXCLUDED.skill_description,
      nep_skill_mapping = EXCLUDED.nep_skill_mapping, cognitive_level = EXCLUDED.cognitive_level,
      ai_confidence = EXCLUDED.ai_confidence, human_edited = EXCLUDED.human_edited,
      option_a = EXCLUDED.option_a, option_b = EXCLUDED.option_b, option_c = EXCLUDED.option_c, option_d = EXCLUDED.option_d,
      key_answer = EXCLUDED.key_answer, ai_answer = EXCLUDED.ai_answer, ai_reason = EXCLUDED.ai_reason,
      recheck_answer = EXCLUDED.recheck_answer, recheck_confidence = EXCLUDED.recheck_confidence,
      recheck_reason = EXCLUDED.recheck_reason, rechecked_at = EXCLUDED.rechecked_at,
      figure_page = EXCLUDED.figure_page, figure_box = EXCLUDED.figure_box, check_status = EXCLUDED.check_status;

    -- Questions the source doesn't have are removed, unless students are already on the
    -- target (removing would score them 0; the guard refuses it).
    IF COALESCE(r.tgt_results, 0) = 0 THEN
      DELETE FROM public.questions q
       WHERE q.paper_id = v_tgt
         AND NOT EXISTS (SELECT 1 FROM public.questions s WHERE s.paper_id = r.src AND s.question_number = q.question_number);
    END IF;

    UPDATE public.question_papers tp
       SET pdf_r2_key = sp.pdf_r2_key, pdf_file_name = sp.pdf_file_name, status = sp.status
      FROM public.question_papers sp
     WHERE tp.id = v_tgt AND sp.id = r.src;
    v_done := v_done + 1;
  END LOOP;
  TRUNCATE pg_temp.results_copy_plan;

  RETURN jsonb_build_object('ok', true, 'dryRun', false, 'items', v_items, 'copied', v_done);
END
$$;

REVOKE ALL ON FUNCTION public.results_copy_slot_papers(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.results_copy_slot_papers(uuid, uuid, boolean) TO authenticated;

COMMIT;
