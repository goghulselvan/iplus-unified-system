-- Results: a linked paper (made by "Same questions for all slots") is read-only.
--
-- Its questions, answer key, flag decisions, PDF and Ready/Draft follow the source paper
-- automatically. Any direct change to it is refused with a plain-English message telling
-- staff to change the same question on the source slot's paper. Unlinking stays allowed.
-- The automatic copy (results_copy_questions, results_paper_sync_linked) marks itself with
-- a transaction-local setting so the guards let it through.
--
-- Changes: two guard triggers; results_copy_questions and results_paper_sync_linked get
-- the "syncing" marker (bodies otherwise unchanged). No data is changed.
BEGIN;

CREATE FUNCTION public.results_linked_syncing() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public
AS $$ SELECT COALESCE(current_setting('results.linked_sync', true), '') = 'on' $$;

-- Plain-English refusal for a linked paper.
CREATE FUNCTION public.results_linked_refusal(p_paper_id uuid, p_question int) RETURNS text
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT CASE WHEN p_question IS NULL
           THEN format('This paper follows the %s paper, so changes can''t be saved here. Please make the change on the %s paper.',
                       COALESCE(t.slot_name, 'source'), COALESCE(t.slot_name, 'source'))
           ELSE format('This paper follows the %s paper, so changes can''t be saved here. Please change question %s on the %s paper.',
                       COALESCE(t.slot_name, 'source'), p_question, COALESCE(t.slot_name, 'source')) END
    FROM public.question_papers tp
    LEFT JOIN public.question_papers sp ON sp.id = tp.linked_from_paper_id
    LEFT JOIN public.exam_slot_templates t ON t.id = sp.slot_template_id
   WHERE tp.id = p_paper_id
$$;

CREATE FUNCTION public.results_questions_linked_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_row public.questions%ROWTYPE;
BEGIN
  IF public.results_linked_syncing() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF EXISTS (SELECT 1 FROM public.question_papers WHERE id = v_row.paper_id AND linked_from_paper_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.question_papers WHERE id = OLD.paper_id AND linked_from_paper_id IS NOT NULL)) THEN
    RAISE EXCEPTION '%', public.results_linked_refusal(v_row.paper_id, v_row.question_number);
  END IF;
  RETURN v_row;
END
$$;

CREATE TRIGGER questions_linked_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.results_questions_linked_guard();

-- A linked paper's PDF and Ready/Draft follow the source; unlinking is always allowed.
CREATE FUNCTION public.results_paper_linked_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF OLD.linked_from_paper_id IS NOT NULL AND NEW.linked_from_paper_id IS NOT NULL
     AND NOT public.results_linked_syncing()
     AND (NEW.pdf_r2_key, NEW.pdf_file_name, NEW.status) IS DISTINCT FROM (OLD.pdf_r2_key, OLD.pdf_file_name, OLD.status) THEN
    RAISE EXCEPTION '%', public.results_linked_refusal(NEW.id, NULL);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER question_papers_linked_guard
  BEFORE UPDATE ON public.question_papers
  FOR EACH ROW EXECUTE FUNCTION public.results_paper_linked_guard();

-- The automatic copy marks itself so the guards let it through (rest unchanged from 20261127).
CREATE OR REPLACE FUNCTION public.results_copy_questions(p_src uuid, p_tgt uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('results.linked_sync', true);
BEGIN
  -- Lets the linked-paper guards through for this automatic copy.
  PERFORM set_config('results.linked_sync', 'on', true);
  INSERT INTO public.questions AS t
         (paper_id, question_number, question_text, has_figure, correct_answer, is_grace, skill_category,
          skill_description, nep_skill_mapping, cognitive_level, ai_confidence, human_edited,
          option_a, option_b, option_c, option_d, key_answer, ai_answer, ai_reason,
          recheck_answer, recheck_confidence, recheck_reason, rechecked_at, figure_page, figure_box, check_status)
  SELECT p_tgt, q.question_number, q.question_text, q.has_figure, q.correct_answer, q.is_grace, q.skill_category,
         q.skill_description, q.nep_skill_mapping, q.cognitive_level, q.ai_confidence, q.human_edited,
         q.option_a, q.option_b, q.option_c, q.option_d, q.key_answer, q.ai_answer, q.ai_reason,
         q.recheck_answer, q.recheck_confidence, q.recheck_reason, q.rechecked_at, q.figure_page, q.figure_box, q.check_status
    FROM public.questions q WHERE q.paper_id = p_src
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
    figure_page = EXCLUDED.figure_page, figure_box = EXCLUDED.figure_box, check_status = EXCLUDED.check_status
  WHERE (t.question_text, t.has_figure, t.correct_answer, t.is_grace, t.skill_category, t.skill_description,
         t.nep_skill_mapping, t.cognitive_level, t.ai_confidence, t.human_edited, t.option_a, t.option_b, t.option_c,
         t.option_d, t.key_answer, t.ai_answer, t.ai_reason, t.recheck_answer, t.recheck_confidence, t.recheck_reason,
         t.rechecked_at, t.figure_page, t.figure_box, t.check_status)
        IS DISTINCT FROM
        (EXCLUDED.question_text, EXCLUDED.has_figure, EXCLUDED.correct_answer, EXCLUDED.is_grace, EXCLUDED.skill_category,
         EXCLUDED.skill_description, EXCLUDED.nep_skill_mapping, EXCLUDED.cognitive_level, EXCLUDED.ai_confidence,
         EXCLUDED.human_edited, EXCLUDED.option_a, EXCLUDED.option_b, EXCLUDED.option_c, EXCLUDED.option_d,
         EXCLUDED.key_answer, EXCLUDED.ai_answer, EXCLUDED.ai_reason, EXCLUDED.recheck_answer, EXCLUDED.recheck_confidence,
         EXCLUDED.recheck_reason, EXCLUDED.rechecked_at, EXCLUDED.figure_page, EXCLUDED.figure_box, EXCLUDED.check_status);

  IF NOT EXISTS (SELECT 1 FROM public.result_evaluations e WHERE e.paper_id = p_tgt AND e.deleted_at IS NULL) THEN
    DELETE FROM public.questions q
     WHERE q.paper_id = p_tgt
       AND NOT EXISTS (SELECT 1 FROM public.questions s WHERE s.paper_id = p_src AND s.question_number = q.question_number);
  END IF;

  UPDATE public.question_papers tp
     SET pdf_r2_key = sp.pdf_r2_key, pdf_file_name = sp.pdf_file_name, status = sp.status
    FROM public.question_papers sp
   WHERE tp.id = p_tgt AND sp.id = p_src
     AND (tp.pdf_r2_key, tp.pdf_file_name, tp.status) IS DISTINCT FROM (sp.pdf_r2_key, sp.pdf_file_name, sp.status);
  PERFORM set_config('results.linked_sync', COALESCE(v_prev, ''), true);
END
$$;

CREATE OR REPLACE FUNCTION public.results_paper_sync_linked() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_prev text := current_setting('results.linked_sync', true);
BEGIN
  IF NEW.linked_from_paper_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('results.linked_sync', 'on', true);
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE public.question_papers SET linked_from_paper_id = NULL WHERE linked_from_paper_id = NEW.id;
  ELSE
    UPDATE public.question_papers tp
       SET pdf_r2_key = NEW.pdf_r2_key, pdf_file_name = NEW.pdf_file_name, status = NEW.status
     WHERE tp.linked_from_paper_id = NEW.id AND tp.deleted_at IS NULL
       AND (tp.pdf_r2_key, tp.pdf_file_name, tp.status) IS DISTINCT FROM (NEW.pdf_r2_key, NEW.pdf_file_name, NEW.status);
  END IF;
  PERFORM set_config('results.linked_sync', COALESCE(v_prev, ''), true);
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.results_linked_syncing(), public.results_linked_refusal(uuid, int),
  public.results_questions_linked_guard(), public.results_paper_linked_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
