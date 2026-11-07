-- Results: answer key cross-check (spec .superpowers/sdd/2026-11-07-answer-key-crosscheck/spec.md).
--
-- Additive only: new nullable / defaulted columns on public.questions. No data is
-- changed, no trigger, policy or function is touched.
--
--   * option_a..option_d  - option texts as printed ('' when the option is only a picture)
--   * key_answer          - from the uploaded official answer key; NULL = no key yet
--   * ai_answer, ai_reason - the AI's own first-pass answer and one-sentence reason
--                           (kept even when the key or a person overrides it)
--   * recheck_*           - the AI's second, from-scratch solve of a question whose
--                           first answer disagreed with the key (never told the key)
--   * figure_page/box     - where the question (incl. picture and options) sits in the
--                           PDF, so the browser can crop it without AI credits.
--                           Box = fractions of the page, top-left origin.
--   * check_status        - result of checkStatus() in src/lib/results/keyCheck.ts
--                           (same logic in supabase/functions/analyze-paper/keyCheck.ts)
--
-- correct_answer stays THE answer used for scoring. Re-scoring is unaffected: the
-- questions_results_rescore trigger (20261102) only re-scores when correct_answer,
-- is_grace, paper_id or question_number change, so writing these columns never
-- re-scores. Adding a column with a constant default does not rewrite the table.
BEGIN;

ALTER TABLE public.questions
  ADD COLUMN option_a text,
  ADD COLUMN option_b text,
  ADD COLUMN option_c text,
  ADD COLUMN option_d text,
  ADD COLUMN key_answer text
    CONSTRAINT questions_key_answer_check CHECK (key_answer IN ('A','B','C','D')),
  ADD COLUMN ai_answer text
    CONSTRAINT questions_ai_answer_check CHECK (ai_answer IN ('A','B','C','D')),
  ADD COLUMN ai_reason text,
  ADD COLUMN recheck_answer text
    CONSTRAINT questions_recheck_answer_check CHECK (recheck_answer IN ('A','B','C','D')),
  ADD COLUMN recheck_confidence numeric(3,2)
    CONSTRAINT questions_recheck_confidence_check CHECK (recheck_confidence BETWEEN 0 AND 1),
  ADD COLUMN recheck_reason text,
  ADD COLUMN rechecked_at timestamptz,
  ADD COLUMN figure_page int
    CONSTRAINT questions_figure_page_check CHECK (figure_page >= 1),
  ADD COLUMN figure_box jsonb
    CONSTRAINT questions_figure_box_check CHECK (
      figure_box IS NULL OR (
        jsonb_typeof(figure_box) = 'object'
        AND CASE
              WHEN jsonb_typeof(figure_box -> 'x') = 'number'
               AND jsonb_typeof(figure_box -> 'y') = 'number'
               AND jsonb_typeof(figure_box -> 'w') = 'number'
               AND jsonb_typeof(figure_box -> 'h') = 'number'
              THEN (figure_box ->> 'x')::numeric BETWEEN 0 AND 1
               AND (figure_box ->> 'y')::numeric BETWEEN 0 AND 1
               AND (figure_box ->> 'w')::numeric > 0 AND (figure_box ->> 'w')::numeric <= 1
               AND (figure_box ->> 'h')::numeric > 0 AND (figure_box ->> 'h')::numeric <= 1
              ELSE false
            END
      )
    ),
  ADD COLUMN check_status text NOT NULL DEFAULT 'unchecked'
    CONSTRAINT questions_check_status_check
    CHECK (check_status IN ('unchecked','confirmed','key_only','mismatch','mismatch_strong','resolved'));

COMMENT ON COLUMN public.questions.key_answer IS 'Answer from the uploaded official answer key. NULL = no key yet.';
COMMENT ON COLUMN public.questions.ai_answer IS 'The AI''s own first-pass answer, kept even when overridden.';
COMMENT ON COLUMN public.questions.figure_box IS '{"x","y","w","h"} fractions of the page (top-left origin) covering the whole question.';
COMMENT ON COLUMN public.questions.check_status IS 'keyCheck.checkStatus(): unchecked | confirmed | key_only | mismatch | mismatch_strong | resolved.';

COMMIT;
