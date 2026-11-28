-- Results: a question can have more than one correct answer (e.g. "which" and "that"
-- both fit the blank). correct_answer stays THE answer (key checks, AI comparison, the
-- printed key all read it); also_correct holds the other letters that also earn the mark.
-- Scoring compares a student's letter against correct_answer || also_correct.
-- Applied 2026-11-28 with 0 result_evaluations in the database.

ALTER TABLE public.questions
  ADD COLUMN also_correct text CHECK (also_correct ~ '^[ABCD]{1,3}$');

COMMENT ON COLUMN public.questions.also_correct IS
  'Other letters that also earn the mark, e.g. ''A'' when correct_answer is ''B''. NULL = only correct_answer.';

-- Keeps also_correct tidy whatever writes the row (screen, key upload, AI re-run, slot
-- copy): never repeats correct_answer, sorted, NULL when empty, and cleared when the
-- question has no answer or is grace.
CREATE FUNCTION public.results_questions_also_correct_tidy() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.also_correct IS NOT NULL THEN
    IF NEW.correct_answer IS NULL OR NEW.is_grace IS TRUE THEN
      NEW.also_correct := NULL;
    ELSE
      NEW.also_correct := NULLIF((SELECT string_agg(DISTINCT l, '' ORDER BY l)
                                    FROM regexp_split_to_table(NEW.also_correct, '') AS l
                                   WHERE l IN ('A','B','C','D') AND l <> NEW.correct_answer), '');
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER questions_also_correct_tidy
  BEFORE INSERT OR UPDATE OF also_correct, correct_answer, is_grace ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.results_questions_also_correct_tidy();

-- True when a student's answer earns the mark against an accepted-letters string such
-- as 'B' or 'BA'. Blank, 'M' (two answers shaded) and anything but one letter never do.
CREATE FUNCTION public.results_answer_ok(p_answer text, p_accepted text) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT COALESCE(p_answer IN ('A','B','C','D') AND strpos(p_accepted, p_answer) > 0, false)
$$;

-- Scoring, skills, the copying scan, the re-score trigger and the Slot 2 copy now read
-- also_correct. Each body below is the live definition with only those lines changed.

CREATE OR REPLACE FUNCTION public.results_rescore_paper_core(p_paper_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paper  public.question_papers%ROWTYPE;
  v_key    text[];
  v_grace  boolean[];
  v_keyed  boolean;
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
  SELECT array_agg(q.correct_answer || COALESCE(q.also_correct, '') ORDER BY g.n),
         array_agg(COALESCE(q.is_grace, false) ORDER BY g.n)
    INTO v_key, v_grace
    FROM generate_series(1, v_paper.total_questions) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = p_paper_id AND q.question_number = g.n;

  -- NEW (upload-first): OMR answers can be saved before the answer key exists. A paper
  -- is marked only once every question is finished (key or grace, no open AI flag);
  -- until then its students have no score ("waiting for answer key").
  v_keyed := COALESCE(public.results_paper_key_finished(p_paper_id), false);

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

  -- NEW (Phase 4): before-snapshot of every score this rescore can change (rows on this
  -- paper, and rows of students whose live result is on this paper), for Outdated marking.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_score_before_paper
    (enrollment_id uuid, school_id uuid, evaluation_id uuid, total numeric, percentage int, grade text)
    ON COMMIT DROP;
  TRUNCATE pg_temp.results_score_before_paper;
  INSERT INTO pg_temp.results_score_before_paper
  SELECT s.enrollment_id, s.school_id, s.evaluation_id, s.total, s.percentage, s.grade
    FROM public.result_scores s
   WHERE s.paper_id = p_paper_id
      OR s.enrollment_id IN (SELECT e.enrollment_id FROM public.result_evaluations e
                              WHERE e.paper_id = p_paper_id AND e.status = 'evaluated' AND e.deleted_at IS NULL);

  -- Rows on this paper that no longer have a live evaluated result on it (absent / deleted),
  -- or every row on it while the answer key is incomplete.
  DELETE FROM public.result_scores s
   WHERE s.paper_id = p_paper_id
     AND (NOT v_keyed OR NOT EXISTS (SELECT 1 FROM public.result_evaluations e
                      WHERE e.enrollment_id = s.enrollment_id
                        AND e.paper_id = p_paper_id
                        AND e.status = 'evaluated'
                        AND e.deleted_at IS NULL));

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
          -- NEW (20261129): a totals-only manual result (LKG-Class 2) is its total as entered.
          SELECT CASE WHEN e.total_marks IS NOT NULL THEN least(e.total_marks, v_paper.total_questions)
                      ELSE COALESCE(sum(
                   CASE
                     WHEN v_grace[g.n] THEN 1
                     WHEN e.answers IS NOT NULL THEN CASE WHEN public.results_answer_ok(e.answers[g.n], v_key[g.n]) THEN 1 ELSE 0 END
                     ELSE COALESCE(e.marks[g.n], 0)
                   END), 0) END::numeric(5,1) AS total
            FROM generate_series(1, v_paper.total_questions) AS g(n)
        ) t
   CROSS JOIN LATERAL (SELECT round(t.total * 100 / v_paper.total_questions)::int AS pct) p
   WHERE v_keyed
     AND e.paper_id = p_paper_id
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

  -- NEW (Phase 4): AI feedback of students whose result (evaluation, total, % or grade)
  -- changed or disappeared, and the AI analysis of their schools, become Outdated.
  -- Rank-only changes don't: the AI text never sees ranks.
  WITH ch AS (
    SELECT COALESCE(a.enrollment_id, b.enrollment_id) AS enrollment_id,
           a.school_id AS school_after, b.school_id AS school_before
      FROM pg_temp.results_score_before_paper AS b
      FULL JOIN (SELECT s.enrollment_id, s.school_id, s.evaluation_id, s.total, s.percentage, s.grade
                   FROM public.result_scores s WHERE s.paper_id = p_paper_id) AS a
        ON a.enrollment_id = b.enrollment_id
     WHERE (a.evaluation_id, a.total, a.percentage, a.grade)
           IS DISTINCT FROM (b.evaluation_id, b.total, b.percentage, b.grade)
  ),
  fb AS (
    UPDATE public.result_feedback f
       SET outdated = true
     WHERE f.enrollment_id IN (SELECT ch.enrollment_id FROM ch)
       AND NOT f.outdated
    RETURNING 1
  )
  UPDATE public.result_school_analysis sa
     SET outdated = true
   WHERE sa.project_id = v_paper.project_id
     AND NOT sa.outdated
     AND sa.school_id IN (SELECT ch.school_after FROM ch WHERE ch.school_after IS NOT NULL
                          UNION SELECT ch.school_before FROM ch WHERE ch.school_before IS NOT NULL);

  TRUNCATE pg_temp.results_score_before;
  TRUNCATE pg_temp.results_score_before_paper;
END
$function$;

CREATE OR REPLACE FUNCTION public.results_paper_skill_keys(p_paper_ids uuid[])
 RETURNS TABLE(paper_id uuid, keys text[], grace boolean[], skills text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT qp.id,
         array_agg(q.correct_answer || COALESCE(q.also_correct, '') ORDER BY g.n),
         array_agg(COALESCE(q.is_grace, false) ORDER BY g.n),
         array_agg(NULLIF(btrim(q.skill_category), '') ORDER BY g.n)
    FROM public.question_papers qp
   CROSS JOIN LATERAL generate_series(1, qp.total_questions) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = qp.id AND q.question_number = g.n
   WHERE qp.id = ANY (p_paper_ids)
   GROUP BY qp.id
$function$;

CREATE OR REPLACE FUNCTION public.results_skill_credit(p_answers text[], p_marks numeric[], p_keys text[], p_grace boolean[], p_skills text[])
 RETURNS TABLE(skill text, correct numeric, total integer, first_q integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT p_skills[g.n],
         sum(CASE
               WHEN p_grace[g.n] THEN 1
               WHEN p_answers IS NOT NULL THEN CASE WHEN public.results_answer_ok(p_answers[g.n], p_keys[g.n]) THEN 1 ELSE 0 END
               ELSE COALESCE(p_marks[g.n], 0)
             END)::numeric,
         count(*)::int,
         min(g.n)
    FROM generate_series(1, cardinality(p_skills)) AS g(n)
   WHERE p_skills[g.n] IS NOT NULL
   GROUP BY p_skills[g.n]
$function$;

CREATE OR REPLACE FUNCTION public.results_integrity_scan(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scan    uuid := gen_random_uuid();
  v_kept    int;
  v_found   int;
  v_ins     int;
  v_groups  int;
  v_res     jsonb;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  -- One scan per project at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('results_integrity|' || p_project_id::text, 0));

  CREATE TEMPORARY TABLE IF NOT EXISTS results_scan_students (
    enrollment_id uuid, school_id uuid, paper_id uuid, class_code text, olympiad_code text,
    state_code text, digits numeric, pct numeric, answers text[], nq int
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_scan_students;
  INSERT INTO pg_temp.results_scan_students
  SELECT rs.enrollment_id, rs.school_id, rs.paper_id, rs.class_code, rs.olympiad_code, rs.state_code,
         NULLIF(public.results_digits(pe.registration_number), '')::numeric,
         rs.total * 100.0 / rs.max_marks, e.answers, rs.max_marks
    FROM public.result_scores rs
    JOIN public.result_evaluations e ON e.id = rs.evaluation_id
    JOIN public.portal_student_enrollments pe ON pe.id = rs.enrollment_id
   WHERE rs.project_id = p_project_id
     AND rs.school_id IS NOT NULL;

  CREATE TEMPORARY TABLE IF NOT EXISTS results_scan_cells (
    enrollment_id uuid, school_id uuid, paper_id uuid, n int, ans text, wrong boolean
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_scan_cells;
  INSERT INTO pg_temp.results_scan_cells
  SELECT s.enrollment_id, s.school_id, s.paper_id, g.n, s.answers[g.n],
         (q.is_grace IS NOT TRUE AND q.correct_answer IS NOT NULL AND NOT public.results_answer_ok(s.answers[g.n], q.correct_answer || COALESCE(q.also_correct, '')))
    FROM pg_temp.results_scan_students s
   CROSS JOIN LATERAL generate_series(1, s.nq) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = s.paper_id AND q.question_number = g.n
   WHERE s.answers IS NOT NULL
     AND s.answers[g.n] IS NOT NULL;
  -- Temp tables are never auto-analyzed; without stats the planner can pick a nested
  -- loop for the self-join below (400k x 400k).
  ANALYZE pg_temp.results_scan_students;
  ANALYZE pg_temp.results_scan_cells;

  CREATE TEMPORARY TABLE IF NOT EXISTS results_scan_new (
    school_id uuid, class_code text, olympiad_code text, flag_type text, severity text,
    details jsonb, ids uuid[]
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_scan_new;

  -- 1. Identical answer strings.
  INSERT INTO pg_temp.results_scan_new
  SELECT s.school_id, min(s.class_code), min(s.olympiad_code), 'identical_answers',
         CASE WHEN count(*) >= 10 THEN 'critical' WHEN count(*) >= 5 THEN 'high' ELSE 'medium' END,
         jsonb_build_object('studentCount', count(*), 'answers', a.astr, 'questions', min(s.nq)),
         array_agg(s.enrollment_id ORDER BY s.digits, s.enrollment_id)
    FROM pg_temp.results_scan_students s
   CROSS JOIN LATERAL (SELECT array_to_string(s.answers, '', '-') AS astr) a
   WHERE s.answers IS NOT NULL
     AND cardinality(array_remove(s.answers, NULL)) * 2 >= s.nq   -- at least half answered
   GROUP BY s.school_id, s.paper_id, a.astr
  HAVING count(*) >= 3;

  -- 2. Same wrong answers (pairs).
  INSERT INTO pg_temp.results_scan_new
  WITH wc AS (
    SELECT c.enrollment_id, count(*) AS w FROM pg_temp.results_scan_cells c WHERE c.wrong GROUP BY c.enrollment_id
  ),
  pr AS (
    SELECT a.school_id, a.paper_id, a.enrollment_id AS ea, b.enrollment_id AS eb, count(*) AS shared
      FROM pg_temp.results_scan_cells a
      JOIN pg_temp.results_scan_cells b
        ON b.school_id = a.school_id AND b.paper_id = a.paper_id AND b.n = a.n AND b.ans = a.ans
       AND b.enrollment_id > a.enrollment_id
     WHERE a.wrong AND b.wrong
     GROUP BY a.school_id, a.paper_id, a.enrollment_id, b.enrollment_id
  ),
  hit AS (
    SELECT pr.*, pr.shared::numeric / greatest(wa.w, wb.w) AS ratio
      FROM pr
      JOIN wc wa ON wa.enrollment_id = pr.ea
      JOIN wc wb ON wb.enrollment_id = pr.eb
     WHERE least(wa.w, wb.w) >= 5
       AND pr.shared::numeric / greatest(wa.w, wb.w) >= 0.6
  )
  SELECT h.school_id, qp.class_code, qp.olympiad_code, 'same_wrong_answers',
         CASE WHEN max(h.ratio) >= 0.8 THEN 'critical' ELSE 'high' END,
         jsonb_build_object(
           'pairCount', count(*),
           'maxSharedPct', round(max(h.ratio) * 100),
           'pairs', to_jsonb((array_agg(jsonb_build_object('a', h.ea, 'b', h.eb, 'shared', h.shared,
                                                           'sharedPct', round(h.ratio * 100))
                                        ORDER BY h.ratio DESC, h.ea, h.eb))[1:100])),
         (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(array_agg(h.ea) || array_agg(h.eb)) AS x)
    FROM hit h
    JOIN public.question_papers qp ON qp.id = h.paper_id
   GROUP BY h.school_id, h.paper_id, qp.class_code, qp.olympiad_code;

  -- 3. Low score variance.
  INSERT INTO pg_temp.results_scan_new
  SELECT g.school_id, g.class_code, g.olympiad_code, 'low_score_variance',
         CASE WHEN g.sd < 2 THEN 'critical' ELSE 'high' END,
         jsonb_build_object('studentCount', g.n, 'stdDev', round(g.sd, 2), 'meanPct', round(g.m, 1)),
         g.ids
    FROM (SELECT s.school_id, s.paper_id, min(s.class_code) AS class_code, min(s.olympiad_code) AS olympiad_code,
                 count(*) AS n, stddev_pop(s.pct) AS sd, avg(s.pct) AS m,
                 array_agg(s.enrollment_id ORDER BY s.digits, s.enrollment_id) AS ids
            FROM pg_temp.results_scan_students s
           GROUP BY s.school_id, s.paper_id) g
   WHERE g.n >= 10 AND g.sd < 3;

  -- 4. Far above the rest of the state.
  INSERT INTO pg_temp.results_scan_new
  WITH g AS (
    SELECT s.school_id, s.class_code, s.olympiad_code, count(*) AS n, avg(s.pct) AS m,
           mode() WITHIN GROUP (ORDER BY s.state_code) AS st,
           array_agg(s.enrollment_id ORDER BY s.digits, s.enrollment_id) AS ids
      FROM pg_temp.results_scan_students s
     GROUP BY s.school_id, s.class_code, s.olympiad_code
  ),
  st AS (
    SELECT s.class_code, s.olympiad_code, s.state_code, sum(s.pct) AS sm, count(*) AS n
      FROM pg_temp.results_scan_students s GROUP BY s.class_code, s.olympiad_code, s.state_code
  ),
  own AS (
    SELECT s.school_id, s.class_code, s.olympiad_code, s.state_code, sum(s.pct) AS sm, count(*) AS n
      FROM pg_temp.results_scan_students s GROUP BY s.school_id, s.class_code, s.olympiad_code, s.state_code
  ),
  cmp AS (
    SELECT g.*, (st.sm - own.sm) / (st.n - own.n) AS other_m, st.n - own.n AS other_n
      FROM g
      JOIN st  ON st.class_code = g.class_code AND st.olympiad_code = g.olympiad_code AND st.state_code = g.st
      JOIN own ON own.school_id = g.school_id AND own.class_code = g.class_code
              AND own.olympiad_code = g.olympiad_code AND own.state_code = g.st
     WHERE g.n >= 5 AND st.n - own.n >= 5
  )
  SELECT c.school_id, c.class_code, c.olympiad_code, 'far_above_state',
         CASE WHEN c.m - c.other_m >= 30 THEN 'critical' ELSE 'high' END,
         jsonb_build_object('studentCount', c.n, 'schoolAvgPct', round(c.m, 1), 'stateAvgPct', round(c.other_m, 1),
                            'gap', round(c.m - c.other_m, 1), 'stateCode', c.st, 'stateStudents', c.other_n),
         c.ids
    FROM cmp c
   WHERE c.m - c.other_m >= 20;

  -- 5. Adjacent copying (chains of consecutive registration numbers).
  INSERT INTO pg_temp.results_scan_new
  WITH o AS (
    SELECT s.*,
           lag(s.digits)  OVER w AS prev_digits,
           lag(s.answers) OVER w AS prev_answers
      FROM pg_temp.results_scan_students s
     WHERE s.answers IS NOT NULL AND s.digits IS NOT NULL
    WINDOW w AS (PARTITION BY s.school_id, s.paper_id ORDER BY s.digits, s.enrollment_id)
  ),
  l AS (
    SELECT o.*, sim.v,
           COALESCE(o.digits - o.prev_digits = 1 AND sim.v >= 0.9, false) AS linked
      FROM o
     CROSS JOIN LATERAL (
            SELECT count(*)::numeric / o.nq AS v
              FROM generate_series(1, o.nq) AS g(n)
             WHERE o.answers[g.n] = o.prev_answers[g.n]) sim
  ),
  i AS (
    SELECT l.*, sum(CASE WHEN l.linked THEN 0 ELSE 1 END)
                  OVER (PARTITION BY l.school_id, l.paper_id ORDER BY l.digits, l.enrollment_id) AS isl
      FROM l
  )
  SELECT i.school_id, min(i.class_code), min(i.olympiad_code), 'adjacent_copying',
         CASE WHEN count(*) >= 3 THEN 'critical' ELSE 'high' END,
         jsonb_build_object('chainLength', count(*),
                            'minSimilarityPct', round(min(i.v) FILTER (WHERE i.linked) * 100)),
         array_agg(i.enrollment_id ORDER BY i.digits, i.enrollment_id)
    FROM i
   GROUP BY i.school_id, i.paper_id, i.isl
  HAVING count(*) FILTER (WHERE i.linked) >= 1;

  -- 6. Answer distribution bias.
  INSERT INTO pg_temp.results_scan_new
  WITH c AS (
    SELECT x.school_id, x.paper_id, x.ans, count(*) AS k
      FROM pg_temp.results_scan_cells x GROUP BY x.school_id, x.paper_id, x.ans
  ),
  t AS (
    SELECT c.school_id, c.paper_id, sum(c.k) AS tot, max(c.k) AS mx,
           (array_agg(c.ans ORDER BY c.k DESC, c.ans))[1] AS letter,
           jsonb_object_agg(c.ans, c.k) AS dist
      FROM c GROUP BY c.school_id, c.paper_id
  ),
  g AS (
    SELECT s.school_id, s.paper_id, min(s.class_code) AS class_code, min(s.olympiad_code) AS olympiad_code,
           count(*) AS n, array_agg(s.enrollment_id ORDER BY s.digits, s.enrollment_id) AS ids
      FROM pg_temp.results_scan_students s WHERE s.answers IS NOT NULL
     GROUP BY s.school_id, s.paper_id
  )
  SELECT g.school_id, g.class_code, g.olympiad_code, 'answer_distribution_bias', 'medium',
         jsonb_build_object('letter', t.letter, 'sharePct', round(t.mx * 100.0 / t.tot), 'distribution', t.dist,
                            'studentCount', g.n,
                            'keySharePct', (SELECT round(100.0 * count(*) FILTER (WHERE q.correct_answer = t.letter)
                                                         / NULLIF(count(*), 0))
                                              FROM public.questions q WHERE q.paper_id = t.paper_id)),
         g.ids
    FROM t
    JOIN g ON g.school_id = t.school_id AND g.paper_id = t.paper_id
   WHERE g.n >= 5 AND t.mx::numeric / t.tot > 0.6;

  -- Replace pending flags; keep reviewed ones and don't re-raise them.
  DELETE FROM public.result_integrity_flags WHERE project_id = p_project_id AND status = 'pending';
  SELECT count(*) INTO v_kept FROM public.result_integrity_flags WHERE project_id = p_project_id;
  SELECT count(*) INTO v_found FROM pg_temp.results_scan_new;
  SELECT count(DISTINCT (s.school_id, s.paper_id)) INTO v_groups FROM pg_temp.results_scan_students s;

  WITH n AS (
    SELECT x.*, md5(concat_ws('|', x.flag_type, x.school_id::text, x.class_code, x.olympiad_code,
                              (SELECT string_agg(y::text, ',' ORDER BY y) FROM unnest(x.ids) AS y))) AS fp
      FROM pg_temp.results_scan_new x
  ),
  ins AS (
    INSERT INTO public.result_integrity_flags
           (project_id, school_id, class_code, olympiad_code, flag_type, severity, details, scan_id, fingerprint)
    SELECT p_project_id, n.school_id, n.class_code, n.olympiad_code, n.flag_type, n.severity,
           n.details || jsonb_build_object('enrollmentIds', to_jsonb(n.ids)), v_scan, n.fp
      FROM n
     WHERE NOT EXISTS (SELECT 1 FROM public.result_integrity_flags f
                        WHERE f.project_id = p_project_id AND f.fingerprint = n.fp)
    RETURNING severity, flag_type
  )
  SELECT count(*),
         jsonb_build_object(
           'scanId', v_scan,
           'groupsScanned', v_groups,
           'flags', count(*),
           'bySeverity', jsonb_build_object('critical', count(*) FILTER (WHERE ins.severity = 'critical'),
                                            'high',     count(*) FILTER (WHERE ins.severity = 'high'),
                                            'medium',   count(*) FILTER (WHERE ins.severity = 'medium')),
           'byType', COALESCE((SELECT jsonb_object_agg(z.flag_type, z.k)
                                 FROM (SELECT i2.flag_type, count(*) AS k FROM ins i2 GROUP BY i2.flag_type) z),
                              '{}'::jsonb))
    INTO v_ins, v_res
    FROM ins;

  TRUNCATE pg_temp.results_scan_students;
  TRUNCATE pg_temp.results_scan_cells;
  TRUNCATE pg_temp.results_scan_new;
  RETURN v_res || jsonb_build_object('keptReviewed', v_kept, 'alreadyReviewed', v_found - v_ins);
END
$function$;

CREATE OR REPLACE FUNCTION public.results_questions_rescore()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                OR n.also_correct IS DISTINCT FROM o.also_correct
                OR n.check_status IS DISTINCT FROM o.check_status
                OR n.paper_id IS DISTINCT FROM o.paper_id
                OR n.question_number IS DISTINCT FROM o.question_number) c
      JOIN public.question_papers qp ON qp.id = c.paper_id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_paper);
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.results_copy_questions(p_src uuid, p_tgt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev text := current_setting('results.linked_sync', true);
BEGIN
  -- Lets the linked-paper guards through for this automatic copy.
  PERFORM set_config('results.linked_sync', 'on', true);
  INSERT INTO public.questions AS t
         (paper_id, question_number, question_text, has_figure, correct_answer, is_grace, skill_category,
          skill_description, nep_skill_mapping, cognitive_level, ai_confidence, human_edited,
          option_a, option_b, option_c, option_d, key_answer, ai_answer, ai_reason,
          recheck_answer, recheck_confidence, recheck_reason, rechecked_at, figure_page, figure_box, check_status, also_correct)
  SELECT p_tgt, q.question_number, q.question_text, q.has_figure, q.correct_answer, q.is_grace, q.skill_category,
         q.skill_description, q.nep_skill_mapping, q.cognitive_level, q.ai_confidence, q.human_edited,
         q.option_a, q.option_b, q.option_c, q.option_d, q.key_answer, q.ai_answer, q.ai_reason,
         q.recheck_answer, q.recheck_confidence, q.recheck_reason, q.rechecked_at, q.figure_page, q.figure_box, q.check_status, q.also_correct
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
    figure_page = EXCLUDED.figure_page, figure_box = EXCLUDED.figure_box, check_status = EXCLUDED.check_status,
    also_correct = EXCLUDED.also_correct
  WHERE (t.question_text, t.has_figure, t.correct_answer, t.is_grace, t.skill_category, t.skill_description,
         t.nep_skill_mapping, t.cognitive_level, t.ai_confidence, t.human_edited, t.option_a, t.option_b, t.option_c,
         t.option_d, t.key_answer, t.ai_answer, t.ai_reason, t.recheck_answer, t.recheck_confidence, t.recheck_reason,
         t.rechecked_at, t.figure_page, t.figure_box, t.check_status, t.also_correct)
        IS DISTINCT FROM
        (EXCLUDED.question_text, EXCLUDED.has_figure, EXCLUDED.correct_answer, EXCLUDED.is_grace, EXCLUDED.skill_category,
         EXCLUDED.skill_description, EXCLUDED.nep_skill_mapping, EXCLUDED.cognitive_level, EXCLUDED.ai_confidence,
         EXCLUDED.human_edited, EXCLUDED.option_a, EXCLUDED.option_b, EXCLUDED.option_c, EXCLUDED.option_d,
         EXCLUDED.key_answer, EXCLUDED.ai_answer, EXCLUDED.ai_reason, EXCLUDED.recheck_answer, EXCLUDED.recheck_confidence,
         EXCLUDED.recheck_reason, EXCLUDED.rechecked_at, EXCLUDED.figure_page, EXCLUDED.figure_box, EXCLUDED.check_status, EXCLUDED.also_correct);

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
$function$;


REVOKE EXECUTE ON FUNCTION public.results_questions_also_correct_tidy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.results_answer_ok(text, text) TO authenticated;
