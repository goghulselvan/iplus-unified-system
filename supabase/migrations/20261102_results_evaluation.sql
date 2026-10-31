-- Results module, Phases 2-3: evaluation, scores, grades and ranks.
--
-- Additive only: four new tables, new functions, three statement triggers on the
-- (Phase 0) questions table, one guard trigger on the (Phase 0) question_papers table,
-- one extra index on portal_student_enrollments, and school_removal_blockers re-created
-- with a 'results' entry. No DROP, no ALTER of any existing table.
--
--   result_upload_batches  one row per confirmed CSV upload
--   result_evaluations     one row per enrolment per attempt; answers (OMR, A-D) or
--                          marks (manual, 0/0.5/1) are ARRAYS on that one row, because
--                          the free-plan database can't afford one row per question.
--                          Replaced / deleted rows are soft-deleted (deleted_at).
--   result_scores          derived: total, %, grade and 4 ranks per evaluated enrolment.
--                          Rebuilt by results_rescore_paper; never edited by hand.
--   result_resend_flags    "Scores changed after release" markers for released schools.
--
-- Rules (plan, Global Constraints):
--   * registration numbers are matched digits only (results_digits) on both sides;
--     state = digits 2-3, district key = digits 2-5 of the registration number.
--   * OMR: 1 mark per answer equal to the key; manual: sum of 0/0.5/1 marks;
--     a grace question gives 1 to every evaluated student. No negative marking.
--   * percentage = round(total * 100 / total_questions).
--   * RANK() with ties per project x class x olympiad (both slots together), at
--     school / district / state / national level, evaluated students only.
--   * uploads are all or nothing; only Ready papers accept uploads.
--
-- Access: SELECT for managers/superadmins via RLS; no write policies at all.
-- Every write goes through a SECURITY DEFINER RPC that checks
-- is_manager_or_superadmin() first. The *_core functions do the work without the
-- role check (so the questions trigger works for any writer) and are not callable
-- by anon / authenticated.
--
-- Concurrency: every writer takes a per-group advisory lock (results_lock_group,
-- project x class x olympiad) before writing, so ranks are computed over a
-- consistent group even when the Slot 1 and Slot 2 files are uploaded at once.
--
-- SCALE LIMIT (read before 5M students): every RPC and the questions triggers run
-- inside the caller's single PostgREST statement, and the authenticated role has
-- statement_timeout = 8s. A rescore re-scores one paper and re-ranks its whole
-- class x olympiad group. That is comfortable at today's ~800 students per group,
-- but groups well above ~50k-100k students (uploads or answer-key edits) will need
-- a chunked path or an edge function using service_role (no role timeout). A
-- function-level SET statement_timeout does NOT extend the running statement.
BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Small helpers
-- ---------------------------------------------------------------------------

-- Digits only. NULL in, NULL out. IMMUTABLE so it can back an index.
CREATE FUNCTION public.results_digits(p text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  SET search_path = public
AS $$ SELECT regexp_replace(p, '\D', '', 'g') $$;

-- Student grade from a whole-number percentage.
CREATE FUNCTION public.results_student_grade(p_percentage int) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT CASE
    WHEN p_percentage IS NULL THEN NULL
    WHEN p_percentage >= 95 THEN 'A++'   -- Olympiad Excellence
    WHEN p_percentage >= 90 THEN 'A+'    -- National Level Potential
    WHEN p_percentage >= 80 THEN 'A'     -- High Performer
    WHEN p_percentage >= 70 THEN 'B+'    -- Strong Foundation
    WHEN p_percentage >= 60 THEN 'B'     -- Satisfactory
    WHEN p_percentage >= 50 THEN 'C'     -- Average
    ELSE 'D'                             -- Needs Academic Support
  END
$$;

-- School grade from the school's average percentage.
CREATE FUNCTION public.results_school_grade(p_avg_percentage numeric) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT CASE
    WHEN p_avg_percentage IS NULL THEN NULL
    WHEN p_avg_percentage >= 80 THEN 'A'   -- Excellent
    WHEN p_avg_percentage >= 60 THEN 'B'   -- Good
    WHEN p_avg_percentage >= 40 THEN 'C'   -- Average
    ELSE 'D'                               -- Needs Improvement
  END
$$;

-- Plain-English olympiad name for error messages ("registered for Maths").
CREATE FUNCTION public.results_olympiad_label(p_code text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT CASE p_code
    WHEN 'EPO'    THEN 'English'
    WHEN 'MPO'    THEN 'Maths'
    WHEN 'SPO'    THEN 'Science'
    WHEN 'GKSSPO' THEN 'GK & Social Science'
    WHEN 'LRPO'   THEN 'Logical Reasoning'
    WHEN 'KidsPO' THEN 'Kids'
    ELSE p_code
  END
$$;

-- Upload matching looks enrolments up by project + digits-only registration number.
-- Without this the match is a scan of every enrolment in the project (5M later).
CREATE INDEX pse_results_reg_digits_idx
  ON public.portal_student_enrollments (project_id, public.results_digits(registration_number));

-- ---------------------------------------------------------------------------
-- (b) Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.result_upload_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id       uuid NOT NULL REFERENCES public.question_papers(id),
  kind           text NOT NULL CHECK (kind IN ('omr','manual')),
  file_name      text,
  row_count      int  NOT NULL DEFAULT 0,
  replaced_count int  NOT NULL DEFAULT 0,
  uploaded_by    uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_upload_batches_paper_idx ON public.result_upload_batches (paper_id);

CREATE TABLE public.result_evaluations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No ON DELETE CASCADE on purpose: an enrolment that has a result can't be
  -- hard-deleted by accident.
  enrollment_id uuid NOT NULL REFERENCES public.portal_student_enrollments(id),
  paper_id      uuid NOT NULL REFERENCES public.question_papers(id),
  status        text NOT NULL CHECK (status IN ('evaluated','absent')),
  answers       text[],            -- OMR: each 'A'..'D' or NULL (unanswered)
  marks         numeric(2,1)[],    -- manual: each 0 / 0.5 / 1 or NULL
  batch_id      uuid REFERENCES public.result_upload_batches(id),
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT result_evaluations_shape_check CHECK (
    (status = 'absent'    AND answers IS NULL AND marks IS NULL)
    OR
    (status = 'evaluated' AND ((answers IS NULL) <> (marks IS NULL)))
  ),
  CONSTRAINT result_evaluations_answers_check CHECK (
    answers IS NULL OR array_remove(answers, NULL) <@ ARRAY['A','B','C','D']::text[]
  ),
  CONSTRAINT result_evaluations_marks_check CHECK (
    marks IS NULL OR array_remove(marks, NULL) <@ ARRAY[0, 0.5, 1]::numeric(2,1)[]
  )
);
-- One live evaluation per enrolment; soft-deleted rows don't count.
CREATE UNIQUE INDEX result_evaluations_live_unique
  ON public.result_evaluations (enrollment_id) WHERE deleted_at IS NULL;
CREATE INDEX result_evaluations_paper_live_idx
  ON public.result_evaluations (paper_id) WHERE deleted_at IS NULL;

CREATE TRIGGER result_evaluations_touch BEFORE INSERT OR UPDATE ON public.result_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.result_touch_updated();
CREATE TRIGGER result_evaluations_audit AFTER INSERT OR UPDATE OR DELETE ON public.result_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();

CREATE TABLE public.result_scores (
  enrollment_id uuid PRIMARY KEY REFERENCES public.portal_student_enrollments(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES public.result_evaluations(id),
  paper_id      uuid NOT NULL REFERENCES public.question_papers(id),
  project_id    uuid NOT NULL,
  school_id     uuid,
  class_code    text NOT NULL,
  olympiad_code text NOT NULL,
  state_code    text,              -- registration number digits 2-3
  district_key  text,              -- registration number digits 2-5 (state + district)
  total         numeric(5,1) NOT NULL,
  max_marks     int NOT NULL,
  percentage    int NOT NULL,
  grade         text NOT NULL,
  rank_school   int,
  rank_district int,
  rank_state    int,
  rank_national int,
  computed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_scores_group_idx  ON public.result_scores (project_id, class_code, olympiad_code);
CREATE INDEX result_scores_school_idx ON public.result_scores (school_id);
CREATE INDEX result_scores_paper_idx  ON public.result_scores (paper_id);

CREATE TABLE public.result_resend_flags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.olympiad_projects(id),
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid
);
-- At most one open flag per school per project (also makes the insert race-safe).
CREATE UNIQUE INDEX result_resend_flags_open_unique
  ON public.result_resend_flags (project_id, school_id) WHERE cleared_at IS NULL;

-- ---------------------------------------------------------------------------
-- (c) Scoring core (no role check; not callable by anon/authenticated)
-- ---------------------------------------------------------------------------

-- One lock per project x class x olympiad group. Every path that changes results
-- takes it before writing, so two rescores of the same group (e.g. the Slot 1 and
-- Slot 2 files uploaded at the same time) run one after the other and ranks stay
-- consistent. Lock order everywhere: group locks (ascending key order) ->
-- question_papers row (FOR NO KEY UPDATE, upload / set_absent only) ->
-- result_evaluations rows. Nobody takes the group lock while holding a paper or
-- evaluation row lock (restore / correct read the row unlocked, lock the group, then
-- re-read FOR UPDATE). FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE that
-- foreign-key checks take on question_papers when result rows are inserted, so a
-- writer that holds the group lock can always finish its inserts.
CREATE FUNCTION public.results_group_key(p_project_id uuid, p_class_code text, p_olympiad_code text)
  RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$ SELECT hashtextextended(p_project_id::text || '|' || p_class_code || '|' || p_olympiad_code, 0) $$;

CREATE FUNCTION public.results_lock_group(p_project_id uuid, p_class_code text, p_olympiad_code text)
  RETURNS void
  LANGUAGE sql
  SET search_path = public
AS $$ SELECT pg_advisory_xact_lock(public.results_group_key(p_project_id, p_class_code, p_olympiad_code)) $$;

-- Re-rank one project x class x olympiad (both slots together). Only rows whose
-- rank actually changes are written. Callers hold the group lock.
CREATE FUNCTION public.results_rerank_core(p_project_id uuid, p_class_code text, p_olympiad_code text)
  RETURNS void
  LANGUAGE sql
  SET search_path = public
AS $$
  UPDATE public.result_scores s
     SET rank_school   = r.rs,
         rank_district = r.rd,
         rank_state    = r.rst,
         rank_national = r.rn
    FROM (
      SELECT x.enrollment_id,
             rank() OVER (PARTITION BY x.school_id    ORDER BY x.total DESC) AS rs,
             rank() OVER (PARTITION BY x.district_key ORDER BY x.total DESC) AS rd,
             rank() OVER (PARTITION BY x.state_code   ORDER BY x.total DESC) AS rst,
             rank() OVER (ORDER BY x.total DESC)                             AS rn
        FROM public.result_scores x
       WHERE x.project_id = p_project_id
         AND x.class_code = p_class_code
         AND x.olympiad_code = p_olympiad_code
    ) r
   WHERE s.enrollment_id = r.enrollment_id
     AND (s.rank_school, s.rank_district, s.rank_state, s.rank_national)
         IS DISTINCT FROM (r.rs::int, r.rd::int, r.rst::int, r.rn::int);
$$;

-- Rebuild result_scores for every enrolment whose live evaluation is on this paper,
-- drop rows that no longer have a live evaluated result on it, re-rank the group,
-- and flag released schools whose students' total / grade / any rank changed.
CREATE FUNCTION public.results_rescore_paper_core(p_paper_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_paper  public.question_papers%ROWTYPE;
  v_key    text[];
  v_grace  boolean[];
BEGIN
  SELECT * INTO v_paper FROM public.question_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Serialise with every other writer of this group. Later statements take a fresh
  -- snapshot, so they see what the transaction we waited for committed. Taken before
  -- the early exit so a key edit can't miss a first upload that is still running.
  PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);

  -- Nothing was ever scored against this paper (e.g. key edits on a fresh draft).
  IF NOT EXISTS (SELECT 1 FROM public.result_evaluations WHERE paper_id = p_paper_id AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.result_scores WHERE paper_id = p_paper_id) THEN
    RETURN;
  END IF;

  -- Answer key and grace flags as arrays indexed by question number 1..total_questions.
  SELECT array_agg(q.correct_answer ORDER BY g.n),
         array_agg(COALESCE(q.is_grace, false) ORDER BY g.n)
    INTO v_key, v_grace
    FROM generate_series(1, v_paper.total_questions) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = p_paper_id AND q.question_number = g.n;

  -- Before-snapshot of the released schools' rows in this group (for resend flags).
  CREATE TEMPORARY TABLE IF NOT EXISTS results_score_before
    (LIKE public.result_scores) ON COMMIT DROP;
  TRUNCATE pg_temp.results_score_before;
  INSERT INTO pg_temp.results_score_before
  SELECT s.*
    FROM public.result_scores s
   WHERE s.project_id = v_paper.project_id
     AND s.class_code = v_paper.class_code
     AND s.olympiad_code = v_paper.olympiad_code
     AND EXISTS (SELECT 1 FROM public.school_result_release r
                  WHERE r.project_id = s.project_id AND r.school_id = s.school_id);

  -- Rows on this paper that no longer have a live evaluated result on it (absent / deleted).
  DELETE FROM public.result_scores s
   WHERE s.paper_id = p_paper_id
     AND NOT EXISTS (SELECT 1 FROM public.result_evaluations e
                      WHERE e.enrollment_id = s.enrollment_id
                        AND e.paper_id = p_paper_id
                        AND e.status = 'evaluated'
                        AND e.deleted_at IS NULL);

  -- Score every live evaluated result on this paper (set-based; unchanged rows untouched).
  INSERT INTO public.result_scores AS rs
         (enrollment_id, evaluation_id, paper_id, project_id, school_id, class_code, olympiad_code,
          state_code, district_key, total, max_marks, percentage, grade, computed_at)
  SELECT e.enrollment_id, e.id, p_paper_id, v_paper.project_id, pe.school_id,
         v_paper.class_code, v_paper.olympiad_code,
         substr(d.digits, 2, 2), substr(d.digits, 2, 4),
         t.total, v_paper.total_questions, p.pct, public.results_student_grade(p.pct), now()
    FROM public.result_evaluations e
    JOIN public.portal_student_enrollments pe ON pe.id = e.enrollment_id
   CROSS JOIN LATERAL (SELECT public.results_digits(pe.registration_number) AS digits) d
   CROSS JOIN LATERAL (
          SELECT COALESCE(sum(
                   CASE
                     WHEN v_grace[g.n] THEN 1
                     WHEN e.answers IS NOT NULL THEN CASE WHEN e.answers[g.n] = v_key[g.n] THEN 1 ELSE 0 END
                     ELSE COALESCE(e.marks[g.n], 0)
                   END), 0)::numeric(5,1) AS total
            FROM generate_series(1, v_paper.total_questions) AS g(n)
        ) t
   CROSS JOIN LATERAL (SELECT round(t.total * 100 / v_paper.total_questions)::int AS pct) p
   WHERE e.paper_id = p_paper_id
     AND e.status = 'evaluated'
     AND e.deleted_at IS NULL
  ON CONFLICT (enrollment_id) DO UPDATE
     SET evaluation_id = EXCLUDED.evaluation_id,
         paper_id      = EXCLUDED.paper_id,
         project_id    = EXCLUDED.project_id,
         school_id     = EXCLUDED.school_id,
         class_code    = EXCLUDED.class_code,
         olympiad_code = EXCLUDED.olympiad_code,
         state_code    = EXCLUDED.state_code,
         district_key  = EXCLUDED.district_key,
         total         = EXCLUDED.total,
         max_marks     = EXCLUDED.max_marks,
         percentage    = EXCLUDED.percentage,
         grade         = EXCLUDED.grade,
         computed_at   = EXCLUDED.computed_at
   WHERE (rs.evaluation_id, rs.paper_id, rs.project_id, rs.school_id, rs.class_code, rs.olympiad_code,
          rs.state_code, rs.district_key, rs.total, rs.max_marks, rs.percentage, rs.grade)
         IS DISTINCT FROM
         (EXCLUDED.evaluation_id, EXCLUDED.paper_id, EXCLUDED.project_id, EXCLUDED.school_id,
          EXCLUDED.class_code, EXCLUDED.olympiad_code, EXCLUDED.state_code, EXCLUDED.district_key,
          EXCLUDED.total, EXCLUDED.max_marks, EXCLUDED.percentage, EXCLUDED.grade);

  PERFORM public.results_rerank_core(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);

  -- Released schools whose students' total, grade or any rank changed (or whose
  -- student gained / lost a score) get one open resend flag. Any rank counts: the
  -- printed report shows all four.
  INSERT INTO public.result_resend_flags (project_id, school_id, reason)
  SELECT DISTINCT v_paper.project_id, x.school_id, 'Scores changed after release'
    FROM (
      SELECT COALESCE(a.school_id, b.school_id) AS school_id
        FROM pg_temp.results_score_before AS b
        FULL JOIN (
          SELECT s.*
            FROM public.result_scores s
           WHERE s.project_id = v_paper.project_id
             AND s.class_code = v_paper.class_code
             AND s.olympiad_code = v_paper.olympiad_code
             AND EXISTS (SELECT 1 FROM public.school_result_release r
                          WHERE r.project_id = s.project_id AND r.school_id = s.school_id)
        ) AS a ON a.enrollment_id = b.enrollment_id
       WHERE (a.total, a.grade, a.rank_school, a.rank_district, a.rank_state, a.rank_national)
             IS DISTINCT FROM
             (b.total, b.grade, b.rank_school, b.rank_district, b.rank_state, b.rank_national)
    ) AS x
   WHERE x.school_id IS NOT NULL
  ON CONFLICT (project_id, school_id) WHERE cleared_at IS NULL DO NOTHING;

  TRUNCATE pg_temp.results_score_before;
END
$$;

-- An answer-key or grace change re-scores every affected paper in the same statement.
CREATE FUNCTION public.results_questions_rescore() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_paper uuid;
BEGIN
  -- Also catches a question renumbered or moved to another paper (both papers re-score).
  -- Papers are visited in group-lock order.
  FOR v_paper IN
    SELECT qp.id
      FROM (SELECT DISTINCT x.paper_id
              FROM results_new_questions n
              JOIN results_old_questions o ON o.id = n.id
             CROSS JOIN LATERAL unnest(ARRAY[n.paper_id, o.paper_id]) AS x(paper_id)
             WHERE n.correct_answer IS DISTINCT FROM o.correct_answer
                OR n.is_grace IS DISTINCT FROM o.is_grace
                OR n.paper_id IS DISTINCT FROM o.paper_id
                OR n.question_number IS DISTINCT FROM o.question_number) c
      JOIN public.question_papers qp ON qp.id = c.paper_id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_paper);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER questions_results_rescore
  AFTER UPDATE ON public.questions
  REFERENCING NEW TABLE AS results_new_questions OLD TABLE AS results_old_questions
  FOR EACH STATEMENT EXECUTE FUNCTION public.results_questions_rescore();

-- Questions added or removed re-score their papers ("copy from Slot 1" upserts then
-- trims; removal is refused on a paper with results, see results_questions_guard).
-- Draft papers with no results exit straight away.
CREATE FUNCTION public.results_questions_rescore_rows() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_paper uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_paper IN
      SELECT qp.id
        FROM (SELECT DISTINCT a.paper_id FROM results_added_questions a) c
        JOIN public.question_papers qp ON qp.id = c.paper_id
       ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
    LOOP
      PERFORM public.results_rescore_paper_core(v_paper);
    END LOOP;
  ELSE
    FOR v_paper IN
      SELECT qp.id
        FROM (SELECT DISTINCT r.paper_id FROM results_removed_questions r) c
        JOIN public.question_papers qp ON qp.id = c.paper_id
       ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
    LOOP
      PERFORM public.results_rescore_paper_core(v_paper);
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER questions_results_rescore_insert
  AFTER INSERT ON public.questions
  REFERENCING NEW TABLE AS results_added_questions
  FOR EACH STATEMENT EXECUTE FUNCTION public.results_questions_rescore_rows();
CREATE TRIGGER questions_results_rescore_delete
  AFTER DELETE ON public.questions
  REFERENCING OLD TABLE AS results_removed_questions
  FOR EACH STATEMENT EXECUTE FUNCTION public.results_questions_rescore_rows();

-- A paper with live results (evaluated or absent) can't be deleted, soft-deleted, or
-- have its project / class / olympiad / slot / question count changed: the stored
-- answer arrays and the scores depend on them.
CREATE FUNCTION public.results_paper_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.result_evaluations WHERE paper_id = OLD.id AND deleted_at IS NULL) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'This paper already has student results, so it can''t be deleted or changed. Delete those results first on the Students page.';
    END IF;
    IF (NEW.deleted_at, NEW.total_questions, NEW.class_code, NEW.olympiad_code, NEW.project_id, NEW.slot_template_id)
       IS DISTINCT FROM
       (OLD.deleted_at, OLD.total_questions, OLD.class_code, OLD.olympiad_code, OLD.project_id, OLD.slot_template_id) THEN
      RAISE EXCEPTION 'This paper already has student results, so it can''t be deleted or changed. Delete those results first on the Students page.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

-- Removing a question from a paper with live results would score every answer to it
-- as 0 (and flag released schools) until it is put back, so it is refused.
CREATE FUNCTION public.results_questions_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.result_evaluations WHERE paper_id = OLD.paper_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This paper already has student results, so its questions can''t be removed. Delete those results first on the Students page.';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER questions_results_guard
  BEFORE DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.results_questions_guard();

CREATE TRIGGER question_papers_results_guard
  BEFORE UPDATE OR DELETE ON public.question_papers
  FOR EACH ROW EXECUTE FUNCTION public.results_paper_guard();

-- ---------------------------------------------------------------------------
-- (d) Upload parsing (internal; called by results_upload)
-- ---------------------------------------------------------------------------

-- One output row per file row: matched enrolment (if any), duplicate marker,
-- normalised answers or marks, and the list of invalid cells.
-- Duplicates are found by position in the array (ord); the client's "row" is only a
-- label (out-of-range or non-numeric values fall back to position + 1).
CREATE FUNCTION public.results_upload_parse(p_paper_id uuid, p_kind text, p_rows jsonb)
  RETURNS TABLE (
    ord           int,
    row_no        int,
    reg           text,
    digits        text,
    n_values      int,
    enrollment_id uuid,
    reg_stored    text,
    student_name  text,
    school_id     uuid,
    enr_olympiad  text,
    enr_class     text,
    dup_first_row int,
    answers       text[],
    marks         numeric[],
    bad           jsonb
  )
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH paper AS (
    SELECT qp.project_id FROM public.question_papers qp WHERE qp.id = p_paper_id
  ),
  f AS (
    SELECT r.ord::int AS ord,
           CASE WHEN jsonb_typeof(r.elem -> 'row') = 'number' THEN
                  CASE WHEN (r.elem ->> 'row')::numeric BETWEEN 1 AND 1000000000
                       THEN round((r.elem ->> 'row')::numeric)::int
                       ELSE r.ord::int + 1 END
                ELSE r.ord::int + 1 END AS row_no,
           NULLIF(btrim(r.elem ->> 'reg'), '') AS reg,
           NULLIF(public.results_digits(r.elem ->> 'reg'), '') AS digits,
           CASE WHEN jsonb_typeof(r.elem -> 'values') = 'array' THEN r.elem -> 'values' ELSE '[]'::jsonb END AS vals
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord)
  ),
  cells AS (
    SELECT f.ord, v.q::int AS q, v.raw,
           CASE WHEN p_kind = 'omr' THEN
             CASE WHEN v.raw IS NULL THEN true ELSE upper(v.raw) IN ('A','B','C','D') END
           ELSE
             CASE WHEN v.raw IS NULL THEN true
                  WHEN v.raw ~ '^[0-9]*\.?[0-9]+$' THEN v.raw::numeric IN (0, 0.5, 1)
                  ELSE false END
           END AS ok
      FROM f
     CROSS JOIN LATERAL (
            SELECT x.q,
                   NULLIF(btrim(CASE WHEN jsonb_typeof(x.val) = 'null' THEN NULL ELSE x.val #>> '{}' END), '') AS raw
              FROM jsonb_array_elements(f.vals) WITH ORDINALITY AS x(val, q)
          ) v
  ),
  agg AS (
    SELECT c.ord,
           array_agg(CASE WHEN c.ok AND c.raw IS NOT NULL THEN upper(c.raw) END ORDER BY c.q) AS answers,
           CASE WHEN p_kind = 'manual' THEN
             array_agg(CASE WHEN p_kind = 'manual' AND c.ok AND c.raw IS NOT NULL THEN c.raw::numeric END ORDER BY c.q)
           END AS marks_all,
           jsonb_agg(jsonb_build_object('q', c.q, 'raw', c.raw) ORDER BY c.q) FILTER (WHERE NOT c.ok) AS bad
      FROM cells c
     GROUP BY c.ord
  )
  SELECT f.ord, f.row_no, f.reg, f.digits, jsonb_array_length(f.vals),
         m.id, m.registration_number, m.student_name, m.school_id, m.olympiad_code, m.class_code,
         CASE WHEN f.digits IS NOT NULL
               AND row_number() OVER (PARTITION BY f.digits ORDER BY f.ord) > 1
              THEN first_value(f.row_no) OVER (PARTITION BY f.digits ORDER BY f.ord) END,
         CASE WHEN p_kind = 'omr' THEN a.answers END,
         a.marks_all,
         a.bad
    FROM f
    LEFT JOIN agg a ON a.ord = f.ord
    LEFT JOIN LATERAL (
          SELECT pe.id, pe.registration_number, st.student_name, pe.school_id, pe.olympiad_code, st.class_code
            FROM public.portal_student_enrollments pe
            JOIN public.portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = (SELECT project_id FROM paper)
             AND public.results_digits(pe.registration_number) = f.digits
           ORDER BY pe.id
           LIMIT 1
        ) m ON f.digits IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- (e) Write RPCs (SECURITY DEFINER, managers / superadmins only)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.results_rescore_paper(p_paper_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  PERFORM public.results_rescore_paper_core(p_paper_id);
END
$$;

CREATE FUNCTION public.results_rerank(p_project_id uuid, p_class_code text, p_olympiad_code text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  PERFORM public.results_lock_group(p_project_id, p_class_code, p_olympiad_code);
  PERFORM public.results_rerank_core(p_project_id, p_class_code, p_olympiad_code);
END
$$;

-- Dry run: validate and summarise, change nothing. Real run: re-validate, soft-delete
-- the replaced live results, insert the new ones, re-score. All or nothing.
-- Problems with the paper itself (missing, not Ready, wrong tab, empty file) RAISE;
-- problems with rows come back as {"ok":false,"errors":[...]}.
-- The file is parsed once into a temp table and reused for validate / summarise / save.
CREATE FUNCTION public.results_upload(p_paper_id uuid, p_kind text, p_file_name text, p_rows jsonb, p_dry_run boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_paper      public.question_papers%ROWTYPE;
  v_class_name text;
  v_manual     boolean;
  v_dry        boolean := COALESCE(p_dry_run, true);
  v_err_total  int;
  v_errors     jsonb;
  v_count      int;
  v_ids        uuid[];
  v_replace    jsonb;
  v_replacing  int;
  v_other_n    int;
  v_other_name text;
  v_missing    int;
  v_batch      uuid;
  v_replaced   int;
  v_saved      int;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;

  SELECT * INTO v_paper FROM public.question_papers WHERE id = p_paper_id;
  IF FOUND AND NOT v_dry THEN
    -- A real run holds the group lock from before validation to the end, so what it
    -- validates is what it saves, and it can't interleave with another writer of the
    -- group (Slot 1 and Slot 2 uploads included). Group lock first, then the paper row
    -- (NO KEY UPDATE: blocks paper edits / soft-delete, not FK checks), then re-read.
    PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);
    SELECT * INTO v_paper FROM public.question_papers WHERE id = p_paper_id FOR NO KEY UPDATE;
  END IF;
  IF NOT FOUND OR v_paper.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This paper no longer exists. Pick another paper.';
  END IF;
  IF v_paper.status <> 'ready' THEN
    RAISE EXCEPTION 'This paper isn''t marked Ready yet. Finish its answer key on the Question Papers page first.';
  END IF;

  SELECT display_name INTO v_class_name FROM public.classes WHERE code = v_paper.class_code;
  v_class_name := COALESCE(v_class_name, 'Class ' || v_paper.class_code);
  v_manual := v_paper.class_code IN ('14','15','01','02');
  IF p_kind IS NULL OR p_kind NOT IN ('omr','manual') THEN
    RAISE EXCEPTION 'Choose Manual or OMR before uploading.';
  END IF;
  IF v_manual AND p_kind <> 'manual' THEN
    RAISE EXCEPTION '% papers are marked by hand. Upload this file on the Manual tab.', v_class_name;
  END IF;
  IF NOT v_manual AND p_kind <> 'omr' THEN
    RAISE EXCEPTION '% papers use OMR sheets. Upload this file on the OMR tab.', v_class_name;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'This file has no student rows.';
  END IF;


  -- 1. Parse once.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_upload_rows (
    ord int, row_no int, reg text, digits text, n_values int, enrollment_id uuid, reg_stored text,
    student_name text, school_id uuid, enr_olympiad text, enr_class text, dup_first_row int,
    answers text[], marks numeric[], bad jsonb
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_upload_rows;
  INSERT INTO pg_temp.results_upload_rows
  SELECT * FROM public.results_upload_parse(p_paper_id, p_kind, p_rows);

  -- 2. Validate. Any error -> nothing is saved.
  WITH errs AS (
    SELECT p.row_no, p.ord, 1 AS s1, 0 AS s2, format('Row %s has no registration number', p.row_no) AS message
      FROM pg_temp.results_upload_rows p WHERE p.digits IS NULL
    UNION ALL
    SELECT p.row_no, p.ord, 2, 0, format('Row %s: %s appears twice in this file (rows %s and %s)',
                                         p.row_no, p.reg, p.dup_first_row, p.row_no)
      FROM pg_temp.results_upload_rows p WHERE p.dup_first_row IS NOT NULL
    UNION ALL
    SELECT p.row_no, p.ord, 3, 0, format('Row %s: %s is not a registered student in this project', p.row_no, p.reg)
      FROM pg_temp.results_upload_rows p WHERE p.digits IS NOT NULL AND p.enrollment_id IS NULL
    UNION ALL
    SELECT p.row_no, p.ord, 4, 0, format('Row %s: %s is registered for %s, but this paper is %s',
                                         p.row_no, p.reg, public.results_olympiad_label(p.enr_olympiad),
                                         public.results_olympiad_label(v_paper.olympiad_code))
      FROM pg_temp.results_upload_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.enr_olympiad IS DISTINCT FROM v_paper.olympiad_code
    UNION ALL
    SELECT p.row_no, p.ord, 5, 0, format('Row %s: %s is a %s student, but this paper is %s',
                                         p.row_no, p.reg,
                                         COALESCE((SELECT c.display_name FROM public.classes c WHERE c.code = p.enr_class),
                                                  'Class ' || p.enr_class),
                                         v_class_name)
      FROM pg_temp.results_upload_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.enr_class IS DISTINCT FROM v_paper.class_code
    UNION ALL
    SELECT p.row_no, p.ord, 6, 0, format('Row %s has %s %s; this paper has %s questions',
                                         p.row_no, p.n_values,
                                         CASE WHEN p_kind = 'omr' THEN 'answers' ELSE 'marks' END,
                                         v_paper.total_questions)
      FROM pg_temp.results_upload_rows p
     WHERE p.n_values <> v_paper.total_questions
    UNION ALL
    SELECT p.row_no, p.ord, 7, (b.cell ->> 'q')::int,
           CASE WHEN p_kind = 'omr'
                THEN format('Row %s, Q%s: "%s" is not A, B, C or D', p.row_no, b.cell ->> 'q', b.cell ->> 'raw')
                ELSE format('Row %s, Q%s: "%s" must be 0, 0.5 or 1', p.row_no, b.cell ->> 'q', b.cell ->> 'raw')
           END
      FROM pg_temp.results_upload_rows p
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.bad, '[]'::jsonb)) AS b(cell)
  ),
  numbered AS (
    SELECT e.*, row_number() OVER (ORDER BY e.row_no, e.ord, e.s1, e.s2) AS rn FROM errs e
  )
  SELECT count(*)::int,
         jsonb_agg(jsonb_build_object('row', n.row_no, 'message', n.message) ORDER BY n.rn)
           FILTER (WHERE n.rn <= 500)
    INTO v_err_total, v_errors
    FROM numbered n;
  IF v_err_total > 0 THEN
    TRUNCATE pg_temp.results_upload_rows;
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'moreErrors', greatest(v_err_total - 500, 0));
  END IF;

  -- 3. Summarise.
  WITH rep AS (
    SELECT p.row_no, p.reg_stored, p.student_name, ev.status
      FROM pg_temp.results_upload_rows p
      JOIN public.result_evaluations ev ON ev.enrollment_id = p.enrollment_id AND ev.deleted_at IS NULL
  ),
  other AS (
    SELECT t.slot_name
      FROM pg_temp.results_upload_rows p
      JOIN public.exam_slots es ON es.school_id = p.school_id AND es.project_id = v_paper.project_id
      JOIN public.exam_slot_templates t ON t.id = es.slot_template_id
     WHERE es.slot_template_id <> v_paper.slot_template_id
  )
  SELECT (SELECT count(*) FROM pg_temp.results_upload_rows),
         (SELECT array_agg(p.enrollment_id) FROM pg_temp.results_upload_rows p),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('reg', rep.reg_stored, 'name', rep.student_name, 'was', rep.status)
                                    ORDER BY rep.row_no), '[]'::jsonb) FROM rep),
         (SELECT count(*) FROM rep),
         (SELECT count(*) FROM other),
         (SELECT mode() WITHIN GROUP (ORDER BY other.slot_name) FROM other),
         -- Registered for this class x olympiad, not in the file, no result yet, and not
         -- booked on another slot: these stay Pending.
         (SELECT count(*)
            FROM public.portal_student_enrollments pe
            JOIN public.portal_registered_students st ON st.id = pe.student_id
           WHERE pe.project_id = v_paper.project_id
             AND pe.olympiad_code = v_paper.olympiad_code
             AND st.class_code = v_paper.class_code
             AND NOT EXISTS (SELECT 1 FROM pg_temp.results_upload_rows p WHERE p.enrollment_id = pe.id)
             AND NOT EXISTS (SELECT 1 FROM public.result_evaluations ev
                              WHERE ev.enrollment_id = pe.id AND ev.deleted_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM public.exam_slots es
                              WHERE es.school_id = pe.school_id AND es.project_id = pe.project_id
                                AND es.slot_template_id IS NOT NULL
                                AND es.slot_template_id <> v_paper.slot_template_id))
    INTO v_count, v_ids, v_replace, v_replacing, v_other_n, v_other_name, v_missing;

  IF v_dry THEN
    TRUNCATE pg_temp.results_upload_rows;
    RETURN jsonb_build_object(
      'ok', true,
      'dryRun', true,
      'count', v_count,
      'replace', v_replace,
      'otherSlot', jsonb_build_object('count', v_other_n, 'slotName', v_other_name),
      'missingFromFile', v_missing);
  END IF;

  -- 4. Save.
  BEGIN
    INSERT INTO public.result_upload_batches (paper_id, kind, file_name, row_count, replaced_count)
    VALUES (p_paper_id, p_kind, p_file_name, v_count, v_replacing)
    RETURNING id INTO v_batch;

    UPDATE public.result_evaluations
       SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND enrollment_id = ANY (v_ids);
    GET DIAGNOSTICS v_replaced = ROW_COUNT;

    INSERT INTO public.result_evaluations (enrollment_id, paper_id, status, answers, marks, batch_id)
    SELECT p.enrollment_id, p_paper_id, 'evaluated',
           CASE WHEN p_kind = 'omr' THEN p.answers END,
           CASE WHEN p_kind = 'manual' THEN p.marks::numeric(2,1)[] END,
           v_batch
      FROM pg_temp.results_upload_rows p;
    GET DIAGNOSTICS v_saved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed this student''s result. Please refresh and try again.';
  END;
  TRUNCATE pg_temp.results_upload_rows;

  IF v_replaced <> v_replacing THEN
    UPDATE public.result_upload_batches SET replaced_count = v_replaced WHERE id = v_batch;
  END IF;

  -- Replaced rows from another paper of the same group are overwritten by this
  -- paper's upsert (result_scores is keyed by enrolment), so one rescore is enough.
  PERFORM public.results_rescore_paper_core(p_paper_id);

  RETURN jsonb_build_object('ok', true, 'saved', v_saved, 'replaced', v_replaced, 'batchId', v_batch);
END
$$;

-- Absent: replace the live result with an 'absent' row. Present: soft-delete the
-- live 'absent' row (the student becomes Pending). Returns the number changed.
CREATE FUNCTION public.results_set_absent(p_paper_id uuid, p_enrollment_ids uuid[], p_absent boolean)
  RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_paper  public.question_papers%ROWTYPE;
  v_bad    int;
  v_n      int := 0;
  v_papers uuid[];
  v_pid    uuid;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  SELECT * INTO v_paper FROM public.question_papers WHERE id = p_paper_id;
  IF NOT FOUND OR v_paper.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This paper no longer exists. Pick another paper.';
  END IF;
  IF p_enrollment_ids IS NULL OR cardinality(p_enrollment_ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_bad
    FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.portal_student_enrollments pe
       JOIN public.portal_registered_students st ON st.id = pe.student_id
      WHERE pe.id = i.id
        AND pe.project_id = v_paper.project_id
        AND pe.olympiad_code = v_paper.olympiad_code
        AND st.class_code = v_paper.class_code);
  IF v_bad = 1 THEN
    RAISE EXCEPTION 'Nothing was changed: 1 of the selected students is not registered for this paper.';
  ELSIF v_bad > 1 THEN
    RAISE EXCEPTION 'Nothing was changed: % of the selected students are not registered for this paper.', v_bad;
  END IF;

  -- Every student here is in this paper's group (checked above), so one lock covers it.
  -- Then hold the paper row so it can't be soft-deleted under us, and re-check.
  PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);
  SELECT * INTO v_paper FROM public.question_papers WHERE id = p_paper_id FOR NO KEY UPDATE;
  IF v_paper.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This paper no longer exists. Pick another paper.';
  END IF;

  BEGIN
    IF COALESCE(p_absent, true) THEN
      WITH old AS (
        UPDATE public.result_evaluations ev
           SET deleted_at = now()
         WHERE ev.deleted_at IS NULL
           AND ev.enrollment_id = ANY (p_enrollment_ids)
           AND NOT (ev.status = 'absent' AND ev.paper_id = p_paper_id)
        RETURNING ev.paper_id
      )
      SELECT array_agg(DISTINCT old.paper_id) INTO v_papers FROM old;

      INSERT INTO public.result_evaluations (enrollment_id, paper_id, status)
      SELECT i.id, p_paper_id, 'absent'
        FROM (SELECT DISTINCT unnest(p_enrollment_ids) AS id) i
       WHERE NOT EXISTS (SELECT 1 FROM public.result_evaluations ev
                          WHERE ev.enrollment_id = i.id AND ev.deleted_at IS NULL);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSE
      WITH old AS (
        UPDATE public.result_evaluations ev
           SET deleted_at = now()
         WHERE ev.deleted_at IS NULL
           AND ev.status = 'absent'
           AND ev.enrollment_id = ANY (p_enrollment_ids)
        RETURNING ev.paper_id
      )
      SELECT array_agg(DISTINCT old.paper_id), count(*) INTO v_papers, v_n FROM old;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed this student''s result. Please refresh and try again.';
  END;

  -- This paper first, then any other paper a replaced result was on (same group).
  PERFORM public.results_rescore_paper_core(p_paper_id);
  FOREACH v_pid IN ARRAY COALESCE(v_papers, '{}'::uuid[]) LOOP
    IF v_pid <> p_paper_id THEN
      PERFORM public.results_rescore_paper_core(v_pid);
    END IF;
  END LOOP;
  RETURN v_n;
END
$$;

-- Soft-delete the live result of each enrolment. Returns the number deleted.
CREATE FUNCTION public.results_delete_evaluations(p_enrollment_ids uuid[]) RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_n      int := 0;
  v_key    bigint;
  v_pid    uuid;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF p_enrollment_ids IS NULL OR cardinality(p_enrollment_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Lock every affected group first, in key order.
  FOR v_key IN
    SELECT DISTINCT public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code)
      FROM public.result_evaluations ev
      JOIN public.question_papers qp ON qp.id = ev.paper_id
     WHERE ev.deleted_at IS NULL
       AND ev.enrollment_id = ANY (p_enrollment_ids)
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  CREATE TEMPORARY TABLE IF NOT EXISTS results_deleted_papers (paper_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.results_deleted_papers;
  WITH d AS (
    UPDATE public.result_evaluations
       SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND enrollment_id = ANY (p_enrollment_ids)
    RETURNING paper_id
  )
  INSERT INTO pg_temp.results_deleted_papers SELECT d.paper_id FROM d;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  FOR v_pid IN
    SELECT qp.id
      FROM (SELECT DISTINCT paper_id FROM pg_temp.results_deleted_papers) x
      JOIN public.question_papers qp ON qp.id = x.paper_id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_pid);
  END LOOP;
  TRUNCATE pg_temp.results_deleted_papers;
  RETURN v_n;
END
$$;

-- Bring back a soft-deleted result (within 30 days, and only if the student has
-- no live result now).
CREATE FUNCTION public.results_restore_evaluation(p_evaluation_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ev    public.result_evaluations%ROWTYPE;
  v_paper public.question_papers%ROWTYPE;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  -- Find the group first (no row lock yet), lock it, then lock and re-read the row.
  SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This result no longer exists.';
  END IF;
  SELECT * INTO v_paper FROM public.question_papers WHERE id = v_ev.paper_id;
  IF NOT FOUND OR v_paper.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This result''s paper has been deleted, so the result can''t be restored.';
  END IF;
  PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);
  SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id FOR UPDATE;

  IF v_ev.deleted_at IS NULL THEN
    RAISE EXCEPTION 'This result hasn''t been deleted, so there is nothing to restore.';
  END IF;
  IF v_ev.deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'This result was deleted more than 30 days ago and can no longer be restored.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.result_evaluations
              WHERE enrollment_id = v_ev.enrollment_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This student already has a newer result.';
  END IF;

  BEGIN
    UPDATE public.result_evaluations SET deleted_at = NULL WHERE id = p_evaluation_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed this student''s result. Please refresh and try again.';
  END;
  PERFORM public.results_rescore_paper_core(v_ev.paper_id);
END
$$;

-- Correct one answer (OMR: 'A'..'D', '' = unanswered) or one mark (manual: '0',
-- '0.5', '1'). The audit trigger keeps the before / after row.
CREATE FUNCTION public.results_correct_answer(p_evaluation_id uuid, p_question_number int, p_value text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ev    public.result_evaluations%ROWTYPE;
  v_paper public.question_papers%ROWTYPE;
  v_raw   text := btrim(COALESCE(p_value, ''));
  v_ok    boolean := false;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  -- Find the group first (no row lock yet), lock it, then lock and re-read the row.
  SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This result no longer exists.';
  END IF;
  SELECT * INTO v_paper FROM public.question_papers WHERE id = v_ev.paper_id;
  IF NOT FOUND OR v_paper.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This result''s paper has been deleted, so it can''t be corrected.';
  END IF;
  PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);
  SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id FOR UPDATE;

  IF v_ev.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This result has been deleted, so it can''t be corrected.';
  END IF;
  IF v_ev.status = 'absent' THEN
    RAISE EXCEPTION 'This student is marked absent, so there are no answers to correct.';
  END IF;
  IF p_question_number IS NULL OR p_question_number < 1 OR p_question_number > v_paper.total_questions THEN
    RAISE EXCEPTION 'This paper has % questions, so there is no Q%.', v_paper.total_questions,
      COALESCE(p_question_number::text, '?');
  END IF;

  IF v_ev.answers IS NOT NULL THEN
    IF v_raw = '' THEN
      UPDATE public.result_evaluations SET answers[p_question_number] = NULL WHERE id = p_evaluation_id;
    ELSIF upper(v_raw) IN ('A','B','C','D') THEN
      UPDATE public.result_evaluations SET answers[p_question_number] = upper(v_raw) WHERE id = p_evaluation_id;
    ELSE
      RAISE EXCEPTION 'Q%: "%" is not A, B, C or D', p_question_number, v_raw;
    END IF;
  ELSE
    IF v_raw ~ '^[0-9]*\.?[0-9]+$' THEN
      v_ok := v_raw::numeric IN (0, 0.5, 1);
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Q%: "%" must be 0, 0.5 or 1', p_question_number, v_raw;
    END IF;
    UPDATE public.result_evaluations SET marks[p_question_number] = v_raw::numeric WHERE id = p_evaluation_id;
  END IF;

  PERFORM public.results_rescore_paper_core(v_ev.paper_id);
END
$$;

-- "Remove from project" must also be blocked by results: an enrolment with a result
-- can't be hard-deleted (no FK cascade), so say so in the dialog instead of failing
-- with a raw FK error. Identical to the 20261101 definition plus the 'results' entry.
CREATE OR REPLACE FUNCTION public.school_removal_blockers(p_school_id uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'students',        NULLIF((SELECT count(*) FROM portal_registered_students WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'enrolments',      NULLIF((SELECT count(*) FROM portal_student_enrollments WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'payments',        NULLIF((SELECT count(*) FROM payment_transactions WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'payment_proofs',  NULLIF((SELECT count(*) FROM payment_proofs WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'portal_payments', NULLIF((SELECT count(*) FROM portal_payment_submissions WHERE school_id = p_school_id AND project_id = p_project_id), 0),
    'book_orders',     NULLIF((SELECT count(*) FROM product_orders WHERE school_id = p_school_id), 0),
    'invoices',        NULLIF((SELECT count(*) FROM invoices WHERE school_id = p_school_id), 0),
    'results',         NULLIF((SELECT count(*) FROM result_evaluations ev JOIN portal_student_enrollments pe ON pe.id = ev.enrollment_id WHERE pe.school_id = p_school_id AND pe.project_id = p_project_id), 0)
  ))
$function$;

-- ---------------------------------------------------------------------------
-- (f) Read RPCs (SECURITY INVOKER, STABLE; RLS decides what the caller sees)
-- ---------------------------------------------------------------------------

-- school_result_release has no manager SELECT policy (superadmin + portal only), so the
-- summaries ask this definer helper which schools are released.
CREATE FUNCTION public.results_released_school_ids(p_project_id uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT r.school_id FROM public.school_result_release r
   WHERE r.project_id = p_project_id AND public.is_manager_or_superadmin()
$$;

-- p_status: 'evaluated' | 'absent' | 'pending' | 'deleted' | NULL (all live statuses).
-- 'deleted' lists soft-deleted results (one row per deleted result, newest first).
CREATE FUNCTION public.results_student_list(
    p_project_id    uuid,
    p_school_id     uuid,
    p_class_code    text,
    p_olympiad_code text,
    p_status        text,
    p_search        text,
    p_limit         int,
    p_offset        int)
  RETURNS TABLE (
    enrollment_id       uuid,
    registration_number text,
    student_name        text,
    school_id           uuid,
    school_name         text,
    class_code          text,
    olympiad_code       text,
    status              text,
    total               numeric,
    percentage          int,
    grade               text,
    evaluation_id       uuid,
    paper_id            uuid,
    deleted_at          timestamptz,
    total_count         bigint)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH base AS (
    SELECT pe.id AS enrollment_id, pe.registration_number, st.student_name, pe.school_id,
           st.class_code, pe.olympiad_code
      FROM public.portal_student_enrollments pe
      JOIN public.portal_registered_students st ON st.id = pe.student_id
     WHERE pe.project_id = p_project_id
       AND (p_school_id IS NULL OR pe.school_id = p_school_id)
       AND (p_class_code IS NULL OR st.class_code = p_class_code)
       AND (p_olympiad_code IS NULL OR pe.olympiad_code = p_olympiad_code)
       AND (NULLIF(btrim(p_search), '') IS NULL
            OR st.student_name ILIKE '%' || btrim(p_search) || '%'
            OR (NULLIF(public.results_digits(p_search), '') IS NOT NULL
                AND public.results_digits(pe.registration_number) LIKE '%' || public.results_digits(p_search) || '%'))
  ),
  live AS (
    SELECT b.*, COALESCE(ev.status, 'pending') AS status, rs.total, rs.percentage, rs.grade,
           ev.id AS evaluation_id, ev.paper_id, NULL::timestamptz AS deleted_at
      FROM base b
      LEFT JOIN public.result_evaluations ev ON ev.enrollment_id = b.enrollment_id AND ev.deleted_at IS NULL
      LEFT JOIN public.result_scores rs ON rs.enrollment_id = b.enrollment_id
     WHERE p_status IS DISTINCT FROM 'deleted'
  ),
  dead AS (
    SELECT b.*, 'deleted'::text AS status, NULL::numeric AS total, NULL::int AS percentage, NULL::text AS grade,
           ev.id AS evaluation_id, ev.paper_id, ev.deleted_at
      FROM base b
      JOIN public.result_evaluations ev ON ev.enrollment_id = b.enrollment_id AND ev.deleted_at IS NOT NULL
     WHERE p_status = 'deleted'
  ),
  listed AS (
    SELECT * FROM live WHERE p_status IS NULL OR live.status = p_status
    UNION ALL
    SELECT * FROM dead
  )
  SELECT r.enrollment_id, r.registration_number, r.student_name, r.school_id, sc.school_name,
         r.class_code, r.olympiad_code, r.status, r.total, r.percentage, r.grade,
         r.evaluation_id, r.paper_id, r.deleted_at,
         count(*) OVER () AS total_count
    FROM listed r
    LEFT JOIN public.schools sc ON sc.id = r.school_id
   ORDER BY r.deleted_at DESC NULLS LAST, r.registration_number NULLS LAST, r.enrollment_id
   LIMIT COALESCE(p_limit, 50) OFFSET COALESCE(p_offset, 0)
$$;

-- One row per school in the project.
CREATE FUNCTION public.results_school_summary(p_project_id uuid)
  RETURNS TABLE (
    school_id            uuid,
    school_name          text,
    state_code           text,
    state_name           text,
    enrolled             bigint,
    evaluated            bigint,
    absent               bigint,
    pending              bigint,
    avg_percentage       numeric,
    school_grade         text,
    state_avg_percentage numeric,
    released             boolean,
    resend_flag          boolean)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH e AS (
    SELECT pe.school_id,
           substr(public.results_digits(pe.registration_number), 2, 2) AS st,
           ev.status, rs.percentage
      FROM public.portal_student_enrollments pe
      LEFT JOIN public.result_evaluations ev ON ev.enrollment_id = pe.id AND ev.deleted_at IS NULL
      LEFT JOIN public.result_scores rs ON rs.enrollment_id = pe.id
     WHERE pe.project_id = p_project_id
       AND pe.school_id IS NOT NULL
  ),
  per_school AS (
    SELECT e.school_id,
           mode() WITHIN GROUP (ORDER BY e.st) AS st,
           count(*) AS enrolled,
           count(*) FILTER (WHERE e.status = 'evaluated') AS evaluated,
           count(*) FILTER (WHERE e.status = 'absent') AS absent,
           round(avg(e.percentage), 1) AS avg_pct
      FROM e GROUP BY e.school_id
  ),
  per_state AS (
    SELECT rs.state_code, round(avg(rs.percentage), 1) AS avg_pct
      FROM public.result_scores rs
     WHERE rs.project_id = p_project_id
     GROUP BY rs.state_code
  ),
  rel AS (SELECT r.school_id FROM public.results_released_school_ids(p_project_id) AS r(school_id))
  SELECT ps.school_id, sc.school_name, ps.st,
         (SELECT s.state_name FROM public.state_codes s WHERE s.state_code = ps.st LIMIT 1),
         ps.enrolled, ps.evaluated, ps.absent, ps.enrolled - ps.evaluated - ps.absent,
         ps.avg_pct, public.results_school_grade(ps.avg_pct), pst.avg_pct,
         EXISTS (SELECT 1 FROM rel WHERE rel.school_id = ps.school_id),
         EXISTS (SELECT 1 FROM public.result_resend_flags f
                  WHERE f.project_id = p_project_id AND f.school_id = ps.school_id AND f.cleared_at IS NULL)
    FROM per_school ps
    LEFT JOIN public.schools sc ON sc.id = ps.school_id
    LEFT JOIN per_state pst ON pst.state_code = ps.st
   ORDER BY sc.school_name, ps.school_id
$$;

-- One row per class x olympiad the school has enrolments in; state average is for the
-- same class x olympiad in the school's state.
CREATE FUNCTION public.results_class_olympiad_summary(p_project_id uuid, p_school_id uuid)
  RETURNS TABLE (
    class_code           text,
    class_name           text,
    olympiad_code        text,
    enrolled             bigint,
    evaluated            bigint,
    absent               bigint,
    pending              bigint,
    avg_percentage       numeric,
    state_avg_percentage numeric)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH e AS (
    SELECT st.class_code, pe.olympiad_code,
           substr(public.results_digits(pe.registration_number), 2, 2) AS stc,
           ev.status, rs.percentage
      FROM public.portal_student_enrollments pe
      JOIN public.portal_registered_students st ON st.id = pe.student_id
      LEFT JOIN public.result_evaluations ev ON ev.enrollment_id = pe.id AND ev.deleted_at IS NULL
      LEFT JOIN public.result_scores rs ON rs.enrollment_id = pe.id
     WHERE pe.project_id = p_project_id
       AND pe.school_id = p_school_id
  ),
  g AS (
    SELECT e.class_code, e.olympiad_code,
           mode() WITHIN GROUP (ORDER BY e.stc) AS stc,
           count(*) AS enrolled,
           count(*) FILTER (WHERE e.status = 'evaluated') AS evaluated,
           count(*) FILTER (WHERE e.status = 'absent') AS absent,
           round(avg(e.percentage), 1) AS avg_pct
      FROM e GROUP BY e.class_code, e.olympiad_code
  )
  SELECT g.class_code, c.display_name, g.olympiad_code,
         g.enrolled, g.evaluated, g.absent, g.enrolled - g.evaluated - g.absent,
         g.avg_pct,
         (SELECT round(avg(rs.percentage), 1)
            FROM public.result_scores rs
           WHERE rs.project_id = p_project_id
             AND rs.class_code = g.class_code
             AND rs.olympiad_code = g.olympiad_code
             AND rs.state_code = g.stc)
    FROM g
    LEFT JOIN public.classes c ON c.code = g.class_code
   ORDER BY CASE WHEN g.class_code IN ('14','15') THEN 0 ELSE 1 END, g.class_code,
            array_position(ARRAY['EPO','MPO','SPO','GKSSPO','LRPO','KidsPO'], g.olympiad_code)
$$;

-- Rank list for one class x olympiad, All-India rank order, optional filters.
CREATE FUNCTION public.results_rank_list(
    p_project_id    uuid,
    p_class_code    text,
    p_olympiad_code text,
    p_limit         int  DEFAULT 100,
    p_offset        int  DEFAULT 0,
    p_state_code    text DEFAULT NULL,
    p_district_key  text DEFAULT NULL,
    p_school_id     uuid DEFAULT NULL)
  RETURNS TABLE (
    enrollment_id       uuid,
    registration_number text,
    student_name        text,
    school_id           uuid,
    school_name         text,
    class_code          text,
    olympiad_code       text,
    state_code          text,
    state_name          text,
    district_key        text,
    district_name       text,
    total               numeric,
    max_marks           int,
    percentage          int,
    grade               text,
    rank_school         int,
    rank_district       int,
    rank_state          int,
    rank_national       int,
    total_count         bigint)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT rs.enrollment_id, pe.registration_number, st.student_name, rs.school_id, sc.school_name,
         rs.class_code, rs.olympiad_code,
         rs.state_code,
         (SELECT s.state_name FROM public.state_codes s WHERE s.state_code = rs.state_code LIMIT 1),
         rs.district_key, dc.district_name,
         rs.total, rs.max_marks, rs.percentage, rs.grade,
         rs.rank_school, rs.rank_district, rs.rank_state, rs.rank_national,
         count(*) OVER () AS total_count
    FROM public.result_scores rs
    JOIN public.portal_student_enrollments pe ON pe.id = rs.enrollment_id
    JOIN public.portal_registered_students st ON st.id = pe.student_id
    LEFT JOIN public.schools sc ON sc.id = rs.school_id
    -- district key = state (2) + district (2); district_codes stores the district as 3 digits.
    LEFT JOIN public.district_codes dc
           ON dc.state_code = rs.state_code
          AND dc.district_code = lpad(substr(rs.district_key, 3, 2), 3, '0')
   WHERE rs.project_id = p_project_id
     AND (p_class_code IS NULL OR rs.class_code = p_class_code)
     AND (p_olympiad_code IS NULL OR rs.olympiad_code = p_olympiad_code)
     AND (p_state_code IS NULL OR rs.state_code = p_state_code)
     AND (p_district_key IS NULL OR rs.district_key = p_district_key)
     AND (p_school_id IS NULL OR rs.school_id = p_school_id)
   ORDER BY rs.rank_national NULLS LAST, pe.registration_number, rs.enrollment_id
   LIMIT COALESCE(p_limit, 100) OFFSET COALESCE(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- (g) Row-level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE public.result_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_evaluations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_scores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_resend_flags   ENABLE ROW LEVEL SECURITY;

CREATE POLICY results_select_upload_batches ON public.result_upload_batches FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_evaluations ON public.result_evaluations FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_scores ON public.result_scores FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_resend_flags ON public.result_resend_flags FOR SELECT
  USING (public.is_manager_or_superadmin());

REVOKE ALL ON public.result_upload_batches, public.result_evaluations,
              public.result_scores, public.result_resend_flags FROM anon;
REVOKE ALL ON public.result_upload_batches, public.result_evaluations,
              public.result_scores, public.result_resend_flags FROM authenticated;
GRANT SELECT ON public.result_upload_batches, public.result_evaluations,
              public.result_scores, public.result_resend_flags TO authenticated;

-- Functions: Supabase grants EXECUTE to PUBLIC / anon / authenticated by default.
-- Take it away from everything, then give the RPCs back to signed-in staff only.
-- results_digits stays executable by everyone: it backs an index on
-- portal_student_enrollments, and index expressions are permission-checked against
-- whoever inserts an enrolment (portal users included). It is a pure function.
REVOKE ALL ON FUNCTION
  public.results_student_grade(int),
  public.results_school_grade(numeric),
  public.results_olympiad_label(text),
  public.results_group_key(uuid, text, text),
  public.results_lock_group(uuid, text, text),
  public.results_rerank_core(uuid, text, text),
  public.results_rescore_paper_core(uuid),
  public.results_questions_rescore(),
  public.results_questions_rescore_rows(),
  public.results_paper_guard(),
  public.results_questions_guard(),
  public.results_upload_parse(uuid, text, jsonb),
  public.results_rescore_paper(uuid),
  public.results_rerank(uuid, text, text),
  public.results_upload(uuid, text, text, jsonb, boolean),
  public.results_set_absent(uuid, uuid[], boolean),
  public.results_delete_evaluations(uuid[]),
  public.results_restore_evaluation(uuid),
  public.results_correct_answer(uuid, int, text),
  public.results_released_school_ids(uuid),
  public.results_student_list(uuid, uuid, text, text, text, text, int, int),
  public.results_school_summary(uuid),
  public.results_class_olympiad_summary(uuid, uuid),
  public.results_rank_list(uuid, text, text, int, int, text, text, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.results_student_grade(int),
  public.results_school_grade(numeric),
  public.results_olympiad_label(text),
  public.results_rescore_paper(uuid),
  public.results_rerank(uuid, text, text),
  public.results_upload(uuid, text, text, jsonb, boolean),
  public.results_set_absent(uuid, uuid[], boolean),
  public.results_delete_evaluations(uuid[]),
  public.results_restore_evaluation(uuid),
  public.results_correct_answer(uuid, int, text),
  public.results_released_school_ids(uuid),
  public.results_student_list(uuid, uuid, text, text, text, text, int, int),
  public.results_school_summary(uuid),
  public.results_class_olympiad_summary(uuid, uuid),
  public.results_rank_list(uuid, text, text, int, int, text, text, uuid)
TO authenticated;

COMMIT;
