-- Results: upload OMR answers first, mark later.
--
-- 1. result_evaluations.answers may hold 'M' (MULTIPLE: more than one bubble shaded).
--    It never equals a key letter, so it scores 0 and counts as wrong. NULL = unanswered.
-- 2. results_rescore_paper_core: an OMR paper is marked only when every question has a
--    key letter or is grace. Until then its students have no score ("waiting for answer
--    key"); when the key is completed the existing question triggers mark everyone.
--    Only the three marked lines change; the rest is the live Phase 4 body.
-- 3. results_student_list: new status 'waiting' = answers saved, no score yet.
-- 4. results_omr_parse + results_upload_omr: one file, any mix of subjects / classes /
--    schools. Each row finds its paper from the roll number (subject + class) and the
--    school's exam slot; missing papers are created empty. All or nothing.
--
-- No table is created or dropped and no data is changed (the results tables are empty).
-- The single-paper results_upload (Manual tab) is unchanged.
BEGIN;

-- ---------------------------------------------------------------------------
-- (1) MULTIPLE answers
-- ---------------------------------------------------------------------------
ALTER TABLE public.result_evaluations DROP CONSTRAINT result_evaluations_answers_check;
ALTER TABLE public.result_evaluations ADD CONSTRAINT result_evaluations_answers_check CHECK (
  answers IS NULL OR array_remove(answers, NULL) <@ ARRAY['A','B','C','D','M']::text[]
);

-- ---------------------------------------------------------------------------
-- (2) Mark only when the answer key is complete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.results_rescore_paper_core(p_paper_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = public
AS $$
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
  SELECT array_agg(q.correct_answer ORDER BY g.n),
         array_agg(COALESCE(q.is_grace, false) ORDER BY g.n)
    INTO v_key, v_grace
    FROM generate_series(1, v_paper.total_questions) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = p_paper_id AND q.question_number = g.n;

  -- NEW (upload-first): OMR answers can be saved before the answer key exists. A paper
  -- is marked only once every question has a key letter or is grace; until then its
  -- students have no score ("waiting for answer key"). Manual papers (LKG-Class 2)
  -- carry their own marks and never need a key.
  v_keyed := v_paper.class_code IN ('14','15','01','02')
             OR NOT EXISTS (SELECT 1 FROM generate_series(1, v_paper.total_questions) AS g(n)
                             WHERE NOT COALESCE(v_grace[g.n], false) AND v_key[g.n] IS NULL);

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
          SELECT COALESCE(sum(
                   CASE
                     WHEN v_grace[g.n] THEN 1
                     WHEN e.answers IS NOT NULL THEN CASE WHEN e.answers[g.n] = v_key[g.n] THEN 1 ELSE 0 END
                     ELSE COALESCE(e.marks[g.n], 0)
                   END), 0)::numeric(5,1) AS total
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
$$;

-- ---------------------------------------------------------------------------
-- (d) Correction with a reason (new overload; the 3-argument version is unchanged)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- (2b) Student list: 'waiting' = answers saved, waiting for the answer key
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.results_student_list(p_project_id uuid, p_school_id uuid, p_class_code text, p_olympiad_code text, p_status text, p_search text, p_limit integer, p_offset integer)
 RETURNS TABLE(enrollment_id uuid, registration_number text, student_name text, school_id uuid, school_name text, class_code text, olympiad_code text, status text, total numeric, percentage integer, grade text, evaluation_id uuid, paper_id uuid, deleted_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
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
    SELECT b.*, CASE WHEN ev.status = 'evaluated' AND rs.enrollment_id IS NULL THEN 'waiting'
                ELSE COALESCE(ev.status, 'pending') END AS status, rs.total, rs.percentage, rs.grade,
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

-- ---------------------------------------------------------------------------
-- (3) OMR upload, any mix of subjects / classes / schools in one file
-- ---------------------------------------------------------------------------

-- One output row per file row. Each row finds its own paper from the student:
-- olympiad (enrolment) x class (student) x slot (the school's exam slot).
-- Only the first <question count> values are read; extra columns are ignored.
-- Cell values: A / B / C / D, MULTIPLE (stored 'M', scores 0), blank (unanswered).
CREATE FUNCTION public.results_omr_parse(p_project_id uuid, p_rows jsonb)
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
    school_name   text,
    olympiad_code text,
    class_code    text,
    slot_count    int,
    slot_template_id uuid,
    paper_id      uuid,
    nq            int,
    dup_first_row int,
    answers       text[],
    bad           jsonb
  )
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH f AS (
    SELECT r.ord::int AS ord,
           CASE WHEN jsonb_typeof(r.elem -> 'row') = 'number' THEN
                  CASE WHEN (r.elem ->> 'row')::numeric BETWEEN 1 AND 1000000000
                       THEN round((r.elem ->> 'row')::numeric)::int
                       ELSE r.ord::int + 1 END
                ELSE r.ord::int + 1 END AS row_no,
           NULLIF(btrim(r.elem ->> 'reg'), '') AS reg,
           -- A roll number is exactly 12 digits (spaces / hyphens allowed). Anything else
           -- ("REVIEW", a short number, letters) is unread.
           CASE WHEN btrim(COALESCE(r.elem ->> 'reg', '')) ~ '^[0-9 -]+$'
                 AND length(public.results_digits(r.elem ->> 'reg')) = 12
                THEN public.results_digits(r.elem ->> 'reg') END AS digits,
           CASE WHEN jsonb_typeof(r.elem -> 'values') = 'array' THEN r.elem -> 'values' ELSE '[]'::jsonb END AS vals
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord)
  ),
  m AS (
    SELECT f.*, x.id AS enrollment_id, x.registration_number, x.student_name, x.school_id,
           x.school_name, x.olympiad_code, x.class_code, x.slot_count, x.slot_template_id,
           qp.id AS paper_id,
           COALESCE(qp.total_questions, c.question_count) AS nq
      FROM f
      LEFT JOIN LATERAL (
            SELECT pe.id, pe.registration_number, st.student_name, pe.school_id, sc.school_name,
                   pe.olympiad_code, st.class_code, sl.n AS slot_count, sl.tid AS slot_template_id
              FROM public.portal_student_enrollments pe
              JOIN public.portal_registered_students st ON st.id = pe.student_id
              LEFT JOIN public.schools sc ON sc.id = pe.school_id
              LEFT JOIN LATERAL (
                    SELECT count(DISTINCT es.slot_template_id)::int AS n, min(es.slot_template_id::text)::uuid AS tid
                      FROM public.exam_slots es
                     WHERE es.school_id = pe.school_id AND es.project_id = p_project_id
                       AND es.slot_template_id IS NOT NULL
                  ) sl ON true
             WHERE pe.project_id = p_project_id
               AND public.results_digits(pe.registration_number) = f.digits
             ORDER BY pe.id
             LIMIT 1
          ) x ON f.digits IS NOT NULL
      LEFT JOIN public.classes c ON c.code = x.class_code
      LEFT JOIN public.question_papers qp
             ON qp.project_id = p_project_id AND qp.class_code = x.class_code
            AND qp.olympiad_code = x.olympiad_code AND qp.slot_template_id = x.slot_template_id
            AND x.slot_count = 1 AND qp.deleted_at IS NULL
  ),
  cells AS (
    SELECT m.ord, v.q::int AS q, v.raw,
           v.raw IS NULL OR upper(v.raw) IN ('A','B','C','D','M','MULTIPLE') AS ok
      FROM m
     CROSS JOIN LATERAL (
            SELECT x.q,
                   NULLIF(btrim(CASE WHEN jsonb_typeof(x.val) = 'null' THEN NULL ELSE x.val #>> '{}' END), '') AS raw
              FROM jsonb_array_elements(m.vals) WITH ORDINALITY AS x(val, q)
          ) v
     WHERE m.nq IS NOT NULL AND v.q <= m.nq
  ),
  agg AS (
    SELECT c.ord,
           array_agg(CASE WHEN NOT c.ok OR c.raw IS NULL THEN NULL
                          WHEN upper(c.raw) IN ('M','MULTIPLE') THEN 'M'
                          ELSE upper(c.raw) END ORDER BY c.q) AS answers,
           jsonb_agg(jsonb_build_object('q', c.q, 'raw', c.raw) ORDER BY c.q) FILTER (WHERE NOT c.ok) AS bad
      FROM cells c
     GROUP BY c.ord
  )
  SELECT m.ord, m.row_no, m.reg, m.digits, jsonb_array_length(m.vals),
         m.enrollment_id, m.registration_number, m.student_name, m.school_id, m.school_name,
         m.olympiad_code, m.class_code, m.slot_count, m.slot_template_id, m.paper_id, m.nq,
         CASE WHEN m.digits IS NOT NULL
               AND row_number() OVER (PARTITION BY m.digits ORDER BY m.ord) > 1
              THEN first_value(m.row_no) OVER (PARTITION BY m.digits ORDER BY m.ord) END,
         a.answers, a.bad
    FROM m
    LEFT JOIN agg a ON a.ord = m.ord
$$;

-- Dry run: check every row and summarise, change nothing. Real run: check again under
-- the locks, create any missing paper (no questions, no key yet), replace the students'
-- live results, insert the new answers, re-score. All or nothing: one bad row and
-- nothing is saved. Row problems come back as {"ok":false,"errors":[{row,kind,reg,message}]}.
CREATE FUNCTION public.results_upload_omr(p_project_id uuid, p_file_name text, p_rows jsonb, p_dry_run boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_dry        boolean := COALESCE(p_dry_run, true);
  v_err_total  int;
  v_errors     jsonb;
  v_count      int;
  v_ids        uuid[];
  v_replace    jsonb;
  v_replacing  int;
  v_papers     jsonb;
  v_key        bigint;
  v_pid        uuid;
  v_replaced   int;
  v_saved      int;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id AND is_active) THEN
    RAISE EXCEPTION 'Results can only be saved for an active olympiad project. Pick the project again.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'This file has no student rows.';
  END IF;

  -- 1. Parse once.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_omr_rows (
    ord int, row_no int, reg text, digits text, n_values int, enrollment_id uuid, reg_stored text,
    student_name text, school_id uuid, school_name text, olympiad_code text, class_code text,
    slot_count int, slot_template_id uuid, paper_id uuid, nq int, dup_first_row int,
    answers text[], bad jsonb, batch_id uuid
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_omr_rows;
  INSERT INTO pg_temp.results_omr_rows SELECT *, NULL::uuid FROM public.results_omr_parse(p_project_id, p_rows);

  -- 2. Check. Any problem -> nothing is saved.
  WITH errs AS (
    SELECT p.row_no, p.ord, 1 AS s1, 0 AS s2, 'unread' AS kind, p.reg,
           CASE WHEN p.reg IS NULL THEN format('Row %s has no roll number', p.row_no)
                WHEN upper(p.reg) = 'REVIEW' THEN format('Row %s: the roll number was not read by the OMR machine ("REVIEW")', p.row_no)
                ELSE format('Row %s: "%s" is not a 12-digit roll number', p.row_no, p.reg) END AS message
      FROM pg_temp.results_omr_rows p WHERE p.digits IS NULL
    UNION ALL
    SELECT p.row_no, p.ord, 2, 0, 'duplicate', p.reg,
           format('Row %s: %s appears twice in this file (rows %s and %s)', p.row_no, p.reg, p.dup_first_row, p.row_no)
      FROM pg_temp.results_omr_rows p WHERE p.dup_first_row IS NOT NULL
    UNION ALL
    SELECT p.row_no, p.ord, 3, 0, 'not_in_crm', p.reg,
           format('Row %s: %s is not a registered student in this project', p.row_no, p.reg)
      FROM pg_temp.results_omr_rows p WHERE p.digits IS NOT NULL AND p.enrollment_id IS NULL
    UNION ALL
    SELECT p.row_no, p.ord, 4, 0, 'manual_class', p.reg,
           format('Row %s: %s is a %s student. LKG to Class 2 marks go on the Manual tab, not OMR',
                  p.row_no, p.reg, COALESCE((SELECT c.display_name FROM public.classes c WHERE c.code = p.class_code),
                                            'Class ' || p.class_code))
      FROM pg_temp.results_omr_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code IN ('14','15','01','02')
    UNION ALL
    SELECT p.row_no, p.ord, 5, 0, 'no_slot', p.reg,
           CASE WHEN COALESCE(p.slot_count, 0) = 0
                THEN format('Row %s: %s''s school (%s) has no exam slot set, so the system can''t tell which paper (Slot 1 or Slot 2) the student wrote',
                            p.row_no, p.reg, COALESCE(p.school_name, 'unknown school'))
                ELSE format('Row %s: %s''s school (%s) has more than one exam slot set, so the system can''t tell which paper the student wrote',
                            p.row_no, p.reg, COALESCE(p.school_name, 'unknown school')) END
      FROM pg_temp.results_omr_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code NOT IN ('14','15','01','02')
       AND COALESCE(p.slot_count, 0) <> 1
    UNION ALL
    SELECT p.row_no, p.ord, 6, 0, 'short', p.reg,
           format('Row %s has only %s answer columns, but %s papers have %s questions',
                  p.row_no, p.n_values,
                  COALESCE((SELECT c.display_name FROM public.classes c WHERE c.code = p.class_code), 'Class ' || p.class_code),
                  p.nq)
      FROM pg_temp.results_omr_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code NOT IN ('14','15','01','02') AND p.n_values < p.nq
    UNION ALL
    SELECT p.row_no, p.ord, 7, (b.cell ->> 'q')::int, 'bad_answer', p.reg,
           format('Row %s, Q%s: "%s" is not A, B, C, D, MULTIPLE or blank', p.row_no, b.cell ->> 'q', b.cell ->> 'raw')
      FROM pg_temp.results_omr_rows p
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.bad, '[]'::jsonb)) AS b(cell)
     WHERE p.enrollment_id IS NOT NULL AND p.class_code NOT IN ('14','15','01','02')
  ),
  numbered AS (
    SELECT e.*, row_number() OVER (ORDER BY e.row_no, e.ord, e.s1, e.s2) AS rn FROM errs e
  )
  SELECT count(*)::int,
         jsonb_agg(jsonb_build_object('row', n.row_no, 'kind', n.kind, 'reg', n.reg, 'message', n.message) ORDER BY n.rn)
           FILTER (WHERE n.rn <= 1000)
    INTO v_err_total, v_errors
    FROM numbered n;
  IF v_err_total > 0 THEN
    TRUNCATE pg_temp.results_omr_rows;
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'moreErrors', greatest(v_err_total - 1000, 0));
  END IF;

  -- 3. Summarise: per paper, and the students whose earlier result will be replaced.
  WITH rep AS (
    SELECT p.row_no, p.reg_stored, p.student_name, ev.status
      FROM pg_temp.results_omr_rows p
      JOIN public.result_evaluations ev ON ev.enrollment_id = p.enrollment_id AND ev.deleted_at IS NULL
  ),
  grp AS (
    SELECT p.class_code, p.olympiad_code, p.slot_template_id, min(p.paper_id::text)::uuid AS paper_id,
           count(*)::int AS n
      FROM pg_temp.results_omr_rows p
     GROUP BY p.class_code, p.olympiad_code, p.slot_template_id
  )
  SELECT (SELECT count(*) FROM pg_temp.results_omr_rows),
         (SELECT array_agg(p.enrollment_id) FROM pg_temp.results_omr_rows p),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('reg', rep.reg_stored, 'name', rep.student_name, 'was', rep.status)
                                    ORDER BY rep.row_no), '[]'::jsonb)
            FROM (SELECT * FROM rep ORDER BY rep.row_no LIMIT 500) rep),
         (SELECT count(*) FROM rep),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'classCode', g.class_code,
                    'className', COALESCE(c.display_name, 'Class ' || g.class_code),
                    'olympiadCode', g.olympiad_code,
                    'olympiad', public.results_olympiad_label(g.olympiad_code),
                    'slotName', t.slot_name,
                    'count', g.n,
                    'paperExists', g.paper_id IS NOT NULL,
                    'keyReady', g.paper_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM public.question_papers qp
                         CROSS JOIN LATERAL generate_series(1, qp.total_questions) AS s(n)
                          LEFT JOIN public.questions q ON q.paper_id = qp.id AND q.question_number = s.n
                         WHERE qp.id = g.paper_id
                           AND NOT COALESCE(q.is_grace, false) AND q.correct_answer IS NULL))
                  ORDER BY g.class_code, g.olympiad_code, t.slot_name), '[]'::jsonb)
            FROM grp g
            LEFT JOIN public.classes c ON c.code = g.class_code
            LEFT JOIN public.exam_slot_templates t ON t.id = g.slot_template_id)
    INTO v_count, v_ids, v_replace, v_replacing, v_papers;

  IF v_dry THEN
    TRUNCATE pg_temp.results_omr_rows;
    RETURN jsonb_build_object('ok', true, 'dryRun', true, 'count', v_count,
                              'replacing', v_replacing, 'replace', v_replace, 'papers', v_papers);
  END IF;

  -- 4. Lock every group this upload touches (the new papers' groups and the groups of the
  -- results being replaced), in key order, same as every other results writer.
  FOR v_key IN
    SELECT k FROM (
      SELECT public.results_group_key(p_project_id, p.class_code, p.olympiad_code) AS k
        FROM pg_temp.results_omr_rows p
      UNION
      SELECT public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code)
        FROM public.result_evaluations ev
        JOIN public.question_papers qp ON qp.id = ev.paper_id
       WHERE ev.deleted_at IS NULL AND ev.enrollment_id = ANY (v_ids)
    ) x ORDER BY k
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  -- 5. Missing papers: create them empty (question count from the class). The questions
  -- and answer key are added later on the Question Papers page; marking waits for them.
  INSERT INTO public.question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  SELECT DISTINCT p_project_id, p.class_code, p.olympiad_code, p.slot_template_id, p.nq
    FROM pg_temp.results_omr_rows p
   WHERE p.paper_id IS NULL
  ON CONFLICT (project_id, class_code, olympiad_code, slot_template_id) WHERE deleted_at IS NULL DO NOTHING;

  UPDATE pg_temp.results_omr_rows p
     SET paper_id = qp.id
    FROM public.question_papers qp
   WHERE qp.project_id = p_project_id AND qp.class_code = p.class_code
     AND qp.olympiad_code = p.olympiad_code AND qp.slot_template_id = p.slot_template_id
     AND qp.deleted_at IS NULL
     AND p.paper_id IS DISTINCT FROM qp.id;

  -- Hold the papers so they can't be deleted or have their question count changed under us.
  PERFORM 1 FROM public.question_papers qp
   WHERE qp.id IN (SELECT DISTINCT p.paper_id FROM pg_temp.results_omr_rows p)
   ORDER BY qp.id
     FOR NO KEY UPDATE;

  IF EXISTS (SELECT 1 FROM pg_temp.results_omr_rows p
               JOIN public.question_papers qp ON qp.id = p.paper_id
              WHERE qp.total_questions <> p.nq) THEN
    RAISE EXCEPTION 'A question paper was changed while this file was being saved. Nothing was saved; please upload the file again.';
  END IF;

  -- 6. Save.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_omr_rescore (paper_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.results_omr_rescore;
  BEGIN
    WITH b AS (
      INSERT INTO public.result_upload_batches (paper_id, kind, file_name, row_count, replaced_count)
      SELECT p.paper_id, 'omr', p_file_name, count(*),
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.result_evaluations ev
                                             WHERE ev.enrollment_id = p.enrollment_id AND ev.deleted_at IS NULL))
        FROM pg_temp.results_omr_rows p
       GROUP BY p.paper_id
      RETURNING id, paper_id
    )
    UPDATE pg_temp.results_omr_rows p SET batch_id = b.id
      FROM b WHERE b.paper_id = p.paper_id;

    WITH old AS (
      UPDATE public.result_evaluations
         SET deleted_at = now()
       WHERE deleted_at IS NULL
         AND enrollment_id = ANY (v_ids)
      RETURNING paper_id
    )
    INSERT INTO pg_temp.results_omr_rescore SELECT old.paper_id FROM old;
    GET DIAGNOSTICS v_replaced = ROW_COUNT;

    INSERT INTO public.result_evaluations (enrollment_id, paper_id, status, answers, batch_id)
    SELECT p.enrollment_id, p.paper_id, 'evaluated', p.answers, p.batch_id
      FROM pg_temp.results_omr_rows p;
    GET DIAGNOSTICS v_saved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed one of these students'' results. Nothing was saved; please upload the file again.';
  END;

  INSERT INTO pg_temp.results_omr_rescore SELECT DISTINCT p.paper_id FROM pg_temp.results_omr_rows p;
  TRUNCATE pg_temp.results_omr_rows;

  -- 7. Re-score every touched paper (marks only papers whose key is complete).
  FOR v_pid IN
    SELECT qp.id
      FROM (SELECT DISTINCT paper_id FROM pg_temp.results_omr_rescore) x
      JOIN public.question_papers qp ON qp.id = x.paper_id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_pid);
  END LOOP;
  TRUNCATE pg_temp.results_omr_rescore;

  RETURN jsonb_build_object('ok', true, 'saved', v_saved, 'replaced', v_replaced, 'papers', v_papers);
END
$$;

REVOKE ALL ON FUNCTION
  public.results_omr_parse(uuid, jsonb),
  public.results_upload_omr(uuid, text, jsonb, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.results_upload_omr(uuid, text, jsonb, boolean) TO authenticated;

COMMIT;
