-- Results: Manual tab for LKG to Class 2 (marks evaluated by hand).
--
-- 1. result_evaluations.total_marks: a totals-only result (file with Roll, Name, Total).
--    An evaluated result now holds exactly one of answers (OMR), marks (0/0.5/1 per
--    question) or total_marks. Absent holds none.
-- 2. results_rescore_paper_core: a totals-only result scores its total. Only the marked
--    lines change; the rest is the live body (20261124).
-- 3. results_upload_manual: one upload, every sheet, per-question or totals-only rows,
--    any mix of LKG-Class 2 subjects / classes / schools. Each row finds its paper from the
--    roll number and the school's exam slot (missing papers are created empty; manual
--    papers need no questions or key). Per-question: blank cells = 0, the system adds the
--    total (the file's Total column is ignored). A row with no marks is skipped (the
--    student stays Pending). All or nothing.
-- 4. results_manual_entry: enter / edit one student's marks (total or per question) or
--    mark absent, from the student's page.
-- No data is changed (the results tables are empty).
BEGIN;

ALTER TABLE public.result_evaluations ADD COLUMN total_marks numeric(5,1);
ALTER TABLE public.result_evaluations ADD CONSTRAINT result_evaluations_total_marks_check CHECK (
  total_marks IS NULL OR (total_marks >= 0 AND total_marks * 2 = trunc(total_marks * 2))
);
ALTER TABLE public.result_evaluations DROP CONSTRAINT result_evaluations_shape_check;
ALTER TABLE public.result_evaluations ADD CONSTRAINT result_evaluations_shape_check CHECK (
  (status = 'absent' AND answers IS NULL AND marks IS NULL AND total_marks IS NULL)
  OR
  (status = 'evaluated'
   AND (answers IS NOT NULL)::int + (marks IS NOT NULL)::int + (total_marks IS NOT NULL)::int = 1)
);

CREATE OR REPLACE FUNCTION public.results_rescore_paper_core(p_paper_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
                     WHEN e.answers IS NOT NULL THEN CASE WHEN e.answers[g.n] = v_key[g.n] THEN 1 ELSE 0 END
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
$$;

-- ---------------------------------------------------------------------------
-- (3) Manual upload. Rows: {row, sheet, reg, kind: 'questions' | 'total', values?, total?}
-- Row problems come back as {"ok":false,"errors":[{row, sheet, kind, reg, message}]}.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.results_upload_manual(p_project_id uuid, p_file_name text, p_rows jsonb, p_dry_run boolean)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_dry       boolean := COALESCE(p_dry_run, true);
  v_err_total int;
  v_errors    jsonb;
  v_count     int;
  v_ids       uuid[];
  v_replace   jsonb;
  v_replacing int;
  v_papers    jsonb;
  v_skipped   jsonb;
  v_key       bigint;
  v_pid       uuid;
  v_replaced  int;
  v_saved     int;
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
  CREATE TEMPORARY TABLE IF NOT EXISTS results_manual_rows (
    ord int, row_no int, sheet text, label text, reg text, digits text, kind text, n_values int,
    raw_total text, enrollment_id uuid, reg_stored text, student_name text, school_id uuid,
    school_name text, olympiad_code text, class_code text, slot_count int, slot_template_id uuid,
    paper_id uuid, nq int, blank boolean, marks numeric[], bad jsonb, total numeric, total_ok boolean,
    batch_id uuid
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_manual_rows;

  INSERT INTO pg_temp.results_manual_rows
  WITH f AS (
    SELECT r.ord::int AS ord,
           CASE WHEN jsonb_typeof(r.elem -> 'row') = 'number' AND (r.elem ->> 'row')::numeric BETWEEN 1 AND 1000000000
                THEN round((r.elem ->> 'row')::numeric)::int ELSE r.ord::int + 1 END AS row_no,
           NULLIF(btrim(r.elem ->> 'sheet'), '') AS sheet,
           NULLIF(btrim(r.elem ->> 'reg'), '') AS reg,
           CASE WHEN btrim(COALESCE(r.elem ->> 'reg', '')) ~ '^[0-9 -]+$'
                 AND length(public.results_digits(r.elem ->> 'reg')) = 12
                THEN public.results_digits(r.elem ->> 'reg') END AS digits,
           CASE WHEN r.elem ->> 'kind' = 'total' THEN 'total' ELSE 'questions' END AS kind,
           CASE WHEN jsonb_typeof(r.elem -> 'values') = 'array' THEN r.elem -> 'values' ELSE '[]'::jsonb END AS vals,
           NULLIF(btrim(r.elem ->> 'total'), '') AS raw_total
      FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord)
  ),
  m AS (
    SELECT f.*,
           CASE WHEN f.sheet IS NOT NULL THEN format('Sheet "%s", row %s', f.sheet, f.row_no)
                ELSE format('Row %s', f.row_no) END AS label,
           x.id AS enrollment_id, x.registration_number, x.student_name, x.school_id, x.school_name,
           x.olympiad_code, x.class_code, x.slot_count, x.slot_template_id,
           qp.id AS paper_id, COALESCE(qp.total_questions, c.question_count) AS nq
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
             ORDER BY pe.id LIMIT 1
          ) x ON f.digits IS NOT NULL
      LEFT JOIN public.classes c ON c.code = x.class_code
      LEFT JOIN public.question_papers qp
             ON qp.project_id = p_project_id AND qp.class_code = x.class_code
            AND qp.olympiad_code = x.olympiad_code AND qp.slot_template_id = x.slot_template_id
            AND x.slot_count = 1 AND qp.deleted_at IS NULL
  ),
  cells AS (
    SELECT m.ord, v.q::int AS q, v.raw,
           v.raw IS NULL OR v.raw ~ '^(0(\.0+)?|0?\.50*|1(\.0+)?)$' AS ok
      FROM m
     CROSS JOIN LATERAL (
            SELECT x.q, NULLIF(btrim(CASE WHEN jsonb_typeof(x.val) = 'null' THEN NULL ELSE x.val #>> '{}' END), '') AS raw
              FROM jsonb_array_elements(m.vals) WITH ORDINALITY AS x(val, q)
          ) v
     WHERE m.kind = 'questions' AND (m.nq IS NULL OR v.q <= m.nq)
  ),
  agg AS (
    SELECT c.ord,
           bool_and(c.raw IS NULL) AS blank,
           array_agg(CASE WHEN c.ok AND c.raw IS NOT NULL THEN c.raw::numeric ELSE 0 END ORDER BY c.q) AS marks,
           jsonb_agg(jsonb_build_object('q', c.q, 'raw', c.raw) ORDER BY c.q) FILTER (WHERE NOT c.ok) AS bad
      FROM cells c GROUP BY c.ord
  )
  SELECT m.ord, m.row_no, m.sheet, m.label, m.reg, m.digits, m.kind, jsonb_array_length(m.vals),
         m.raw_total, m.enrollment_id, m.registration_number, m.student_name, m.school_id, m.school_name,
         m.olympiad_code, m.class_code, m.slot_count, m.slot_template_id, m.paper_id, m.nq,
         CASE WHEN m.kind = 'total' THEN m.raw_total IS NULL ELSE COALESCE(a.blank, true) END,
         a.marks, a.bad,
         CASE WHEN m.raw_total ~ '^[0-9]+(\.[0-9]+)?$' THEN m.raw_total::numeric END,
         m.raw_total ~ '^[0-9]+(\.[0-9]+)?$'
           AND m.raw_total::numeric * 2 = trunc(m.raw_total::numeric * 2)
           AND m.raw_total::numeric <= COALESCE(m.nq, 0),
         NULL::uuid
    FROM m LEFT JOIN agg a ON a.ord = m.ord;

  -- Rows with no marks at all are skipped: the student stays Pending.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('row', p.row_no, 'sheet', p.sheet, 'reg', p.reg,
                                               'name', p.student_name) ORDER BY p.ord), '[]'::jsonb)
    INTO v_skipped FROM pg_temp.results_manual_rows p WHERE p.blank;
  DELETE FROM pg_temp.results_manual_rows WHERE blank;

  IF NOT EXISTS (SELECT 1 FROM pg_temp.results_manual_rows) THEN
    TRUNCATE pg_temp.results_manual_rows;
    RETURN jsonb_build_object('ok', false, 'moreErrors', 0, 'errors', jsonb_build_array(jsonb_build_object(
      'row', 0, 'sheet', NULL, 'kind', 'file', 'reg', NULL, 'message', 'This file has no marks in it. Every row is empty.')));
  END IF;

  -- 2. Check. Any problem -> nothing is saved.
  WITH dup AS (
    SELECT p.ord, first_value(p.label) OVER (PARTITION BY p.digits ORDER BY p.ord) AS first_label,
           row_number() OVER (PARTITION BY p.digits ORDER BY p.ord) AS k
      FROM pg_temp.results_manual_rows p WHERE p.digits IS NOT NULL
  ),
  errs AS (
    SELECT p.ord, 1 AS s1, 0 AS s2, 'unread' AS kind, p.reg, p.row_no, p.sheet,
           CASE WHEN p.reg IS NULL THEN format('%s has marks but no roll number', p.label)
                ELSE format('%s: "%s" is not a 12-digit roll number', p.label, p.reg) END AS message
      FROM pg_temp.results_manual_rows p WHERE p.digits IS NULL
    UNION ALL
    SELECT p.ord, 2, 0, 'duplicate', p.reg, p.row_no, p.sheet,
           format('%s: %s appears twice (also at %s)', p.label, p.reg, d.first_label)
      FROM pg_temp.results_manual_rows p JOIN dup d ON d.ord = p.ord AND d.k > 1
    UNION ALL
    SELECT p.ord, 3, 0, 'not_in_crm', p.reg, p.row_no, p.sheet,
           format('%s: %s is not a registered student in this project', p.label, p.reg)
      FROM pg_temp.results_manual_rows p WHERE p.digits IS NOT NULL AND p.enrollment_id IS NULL
    UNION ALL
    SELECT p.ord, 4, 0, 'omr_class', p.reg, p.row_no, p.sheet,
           format('%s: %s is a %s student. Class 3 and above use OMR sheets: upload them on the OMR tab',
                  p.label, p.reg, COALESCE((SELECT c.display_name FROM public.classes c WHERE c.code = p.class_code), 'Class ' || p.class_code))
      FROM pg_temp.results_manual_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code NOT IN ('14','15','01','02')
    UNION ALL
    SELECT p.ord, 5, 0, 'no_slot', p.reg, p.row_no, p.sheet,
           format('%s: %s''s school (%s) has %s exam slot set, so the system can''t tell which paper the student wrote',
                  p.label, p.reg, COALESCE(p.school_name, 'unknown school'),
                  CASE WHEN COALESCE(p.slot_count, 0) = 0 THEN 'no' ELSE 'more than one' END)
      FROM pg_temp.results_manual_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code IN ('14','15','01','02') AND COALESCE(p.slot_count, 0) <> 1
    UNION ALL
    SELECT p.ord, 6, 0, 'short', p.reg, p.row_no, p.sheet,
           format('%s has only %s question columns, but %s papers have %s questions', p.label, p.n_values,
                  COALESCE((SELECT c.display_name FROM public.classes c WHERE c.code = p.class_code), 'Class ' || p.class_code), p.nq)
      FROM pg_temp.results_manual_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code IN ('14','15','01','02') AND p.kind = 'questions' AND p.n_values < p.nq
    UNION ALL
    SELECT p.ord, 7, (b.cell ->> 'q')::int, 'bad_mark', p.reg, p.row_no, p.sheet,
           format('%s, Q%s: "%s" must be 0, 0.5 or 1', p.label, b.cell ->> 'q', b.cell ->> 'raw')
      FROM pg_temp.results_manual_rows p
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.bad, '[]'::jsonb)) AS b(cell)
     WHERE p.enrollment_id IS NOT NULL AND p.class_code IN ('14','15','01','02') AND p.kind = 'questions'
    UNION ALL
    SELECT p.ord, 8, 0, 'bad_total', p.reg, p.row_no, p.sheet,
           format('%s: total "%s" must be a number from 0 to %s, in steps of 0.5', p.label, p.raw_total, p.nq)
      FROM pg_temp.results_manual_rows p
     WHERE p.enrollment_id IS NOT NULL AND p.class_code IN ('14','15','01','02') AND p.kind = 'total'
       AND NOT COALESCE(p.total_ok, false)
  ),
  numbered AS (SELECT e.*, row_number() OVER (ORDER BY e.ord, e.s1, e.s2) AS rn FROM errs e)
  SELECT count(*)::int,
         jsonb_agg(jsonb_build_object('row', n.row_no, 'sheet', n.sheet, 'kind', n.kind, 'reg', n.reg, 'message', n.message)
                   ORDER BY n.rn) FILTER (WHERE n.rn <= 1000)
    INTO v_err_total, v_errors FROM numbered n;
  IF v_err_total > 0 THEN
    TRUNCATE pg_temp.results_manual_rows;
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'moreErrors', greatest(v_err_total - 1000, 0), 'skipped', v_skipped);
  END IF;

  -- 3. Summarise.
  WITH rep AS (
    SELECT p.ord, p.reg_stored, p.student_name, ev.status
      FROM pg_temp.results_manual_rows p
      JOIN public.result_evaluations ev ON ev.enrollment_id = p.enrollment_id AND ev.deleted_at IS NULL
  ),
  grp AS (
    SELECT p.class_code, p.olympiad_code, p.slot_template_id, count(*)::int AS n,
           count(*) FILTER (WHERE p.kind = 'total')::int AS n_total
      FROM pg_temp.results_manual_rows p GROUP BY 1, 2, 3
  )
  SELECT (SELECT count(*) FROM pg_temp.results_manual_rows),
         (SELECT array_agg(p.enrollment_id) FROM pg_temp.results_manual_rows p),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('reg', r.reg_stored, 'name', r.student_name, 'was', r.status) ORDER BY r.ord), '[]'::jsonb)
            FROM (SELECT * FROM rep ORDER BY rep.ord LIMIT 500) r),
         (SELECT count(*) FROM rep),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'classCode', g.class_code, 'className', COALESCE(c.display_name, 'Class ' || g.class_code),
                    'olympiadCode', g.olympiad_code, 'olympiad', public.results_olympiad_label(g.olympiad_code),
                    'slotName', t.slot_name, 'count', g.n, 'totalsOnly', g.n_total)
                  ORDER BY g.class_code, g.olympiad_code, t.slot_name), '[]'::jsonb)
            FROM grp g LEFT JOIN public.classes c ON c.code = g.class_code
            LEFT JOIN public.exam_slot_templates t ON t.id = g.slot_template_id)
    INTO v_count, v_ids, v_replace, v_replacing, v_papers;

  IF v_dry THEN
    TRUNCATE pg_temp.results_manual_rows;
    RETURN jsonb_build_object('ok', true, 'dryRun', true, 'count', v_count, 'replacing', v_replacing,
                              'replace', v_replace, 'papers', v_papers, 'skipped', v_skipped);
  END IF;

  -- 4. Lock every touched group in key order.
  FOR v_key IN
    SELECT k FROM (
      SELECT public.results_group_key(p_project_id, p.class_code, p.olympiad_code) AS k FROM pg_temp.results_manual_rows p
      UNION
      SELECT public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code)
        FROM public.result_evaluations ev JOIN public.question_papers qp ON qp.id = ev.paper_id
       WHERE ev.deleted_at IS NULL AND ev.enrollment_id = ANY (v_ids)
    ) x ORDER BY k
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;

  -- 5. Missing papers: created empty (manual papers need no questions or key).
  INSERT INTO public.question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
  SELECT DISTINCT p_project_id, p.class_code, p.olympiad_code, p.slot_template_id, p.nq
    FROM pg_temp.results_manual_rows p WHERE p.paper_id IS NULL
  ON CONFLICT (project_id, class_code, olympiad_code, slot_template_id) WHERE deleted_at IS NULL DO NOTHING;
  UPDATE pg_temp.results_manual_rows p SET paper_id = qp.id
    FROM public.question_papers qp
   WHERE qp.project_id = p_project_id AND qp.class_code = p.class_code AND qp.olympiad_code = p.olympiad_code
     AND qp.slot_template_id = p.slot_template_id AND qp.deleted_at IS NULL AND p.paper_id IS DISTINCT FROM qp.id;
  PERFORM 1 FROM public.question_papers qp
   WHERE qp.id IN (SELECT DISTINCT p.paper_id FROM pg_temp.results_manual_rows p) ORDER BY qp.id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM pg_temp.results_manual_rows p JOIN public.question_papers qp ON qp.id = p.paper_id
              WHERE qp.total_questions <> p.nq) THEN
    RAISE EXCEPTION 'A question paper was changed while this file was being saved. Nothing was saved; please upload the file again.';
  END IF;

  -- 6. Save.
  CREATE TEMPORARY TABLE IF NOT EXISTS results_manual_rescore (paper_id uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.results_manual_rescore;
  BEGIN
    WITH b AS (
      INSERT INTO public.result_upload_batches (paper_id, kind, file_name, row_count, replaced_count)
      SELECT p.paper_id, 'manual', p_file_name, count(*),
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.result_evaluations ev
                                             WHERE ev.enrollment_id = p.enrollment_id AND ev.deleted_at IS NULL))
        FROM pg_temp.results_manual_rows p GROUP BY p.paper_id
      RETURNING id, paper_id
    )
    UPDATE pg_temp.results_manual_rows p SET batch_id = b.id FROM b WHERE b.paper_id = p.paper_id;

    WITH old AS (
      UPDATE public.result_evaluations SET deleted_at = now()
       WHERE deleted_at IS NULL AND enrollment_id = ANY (v_ids)
      RETURNING paper_id
    )
    INSERT INTO pg_temp.results_manual_rescore SELECT old.paper_id FROM old;
    GET DIAGNOSTICS v_replaced = ROW_COUNT;

    INSERT INTO public.result_evaluations (enrollment_id, paper_id, status, marks, total_marks, batch_id)
    SELECT p.enrollment_id, p.paper_id, 'evaluated',
           CASE WHEN p.kind = 'questions' THEN p.marks::numeric(2,1)[] END,
           CASE WHEN p.kind = 'total' THEN p.total END,
           p.batch_id
      FROM pg_temp.results_manual_rows p;
    GET DIAGNOSTICS v_saved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone else just changed one of these students'' results. Nothing was saved; please upload the file again.';
  END;

  INSERT INTO pg_temp.results_manual_rescore SELECT DISTINCT p.paper_id FROM pg_temp.results_manual_rows p;
  TRUNCATE pg_temp.results_manual_rows;
  FOR v_pid IN
    SELECT qp.id FROM (SELECT DISTINCT paper_id FROM pg_temp.results_manual_rescore) x
      JOIN public.question_papers qp ON qp.id = x.paper_id
     ORDER BY public.results_group_key(qp.project_id, qp.class_code, qp.olympiad_code), qp.id
  LOOP
    PERFORM public.results_rescore_paper_core(v_pid);
  END LOOP;
  TRUNCATE pg_temp.results_manual_rescore;

  RETURN jsonb_build_object('ok', true, 'saved', v_saved, 'replaced', v_replaced, 'papers', v_papers, 'skipped', v_skipped);
END
$$;

-- ---------------------------------------------------------------------------
-- (4) One student (LKG-Class 2): enter or edit marks, or mark absent, from the student's
-- page. p_mode: 'total' (p_total), 'questions' (p_marks, one 0/0.5/1 per question,
-- NULL = 0) or 'absent'. Replaces the student's live result like an upload does.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.results_manual_entry(p_enrollment_id uuid, p_mode text, p_total numeric, p_marks numeric[])
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_pe     record;
  v_nslots int;
  v_slot   uuid;
  v_nq     int;
  v_paper  uuid;
  v_old    uuid;
  v_marks  numeric[];
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  SELECT pe.id, pe.project_id, pe.school_id, pe.olympiad_code, st.class_code INTO v_pe
    FROM public.portal_student_enrollments pe JOIN public.portal_registered_students st ON st.id = pe.student_id
   WHERE pe.id = p_enrollment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This student could not be found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = v_pe.project_id AND is_active) THEN
    RAISE EXCEPTION 'Results can only be changed for an active olympiad project.';
  END IF;
  IF v_pe.class_code NOT IN ('14','15','01','02') THEN
    RAISE EXCEPTION 'Marks can be typed in only for LKG to Class 2. Class 3 and above use OMR sheets.';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('total','questions','absent') THEN
    RAISE EXCEPTION 'Choose total marks, marks per question or absent.';
  END IF;

  SELECT count(DISTINCT es.slot_template_id)::int, min(es.slot_template_id::text)::uuid INTO v_nslots, v_slot
    FROM public.exam_slots es
   WHERE es.school_id = v_pe.school_id AND es.project_id = v_pe.project_id AND es.slot_template_id IS NOT NULL;
  IF v_nslots <> 1 THEN
    RAISE EXCEPTION 'This student''s school has % exam slot set, so the system can''t tell which paper the student wrote. Fix the school''s slot first.',
      CASE WHEN v_nslots = 0 THEN 'no' ELSE 'more than one' END;
  END IF;

  PERFORM public.results_lock_group(v_pe.project_id, v_pe.class_code, v_pe.olympiad_code);
  SELECT id, total_questions INTO v_paper, v_nq FROM public.question_papers
   WHERE project_id = v_pe.project_id AND class_code = v_pe.class_code AND olympiad_code = v_pe.olympiad_code
     AND slot_template_id = v_slot AND deleted_at IS NULL;
  IF v_paper IS NULL THEN
    SELECT question_count INTO v_nq FROM public.classes WHERE code = v_pe.class_code;
    INSERT INTO public.question_papers (project_id, class_code, olympiad_code, slot_template_id, total_questions)
    VALUES (v_pe.project_id, v_pe.class_code, v_pe.olympiad_code, v_slot, v_nq)
    RETURNING id INTO v_paper;
  END IF;

  IF p_mode = 'total' AND (p_total IS NULL OR p_total < 0 OR p_total > v_nq OR p_total * 2 <> trunc(p_total * 2)) THEN
    RAISE EXCEPTION 'The total must be a number from 0 to %, in steps of 0.5.', v_nq;
  END IF;
  IF p_mode = 'questions' THEN
    IF p_marks IS NULL OR cardinality(p_marks) <> v_nq THEN
      RAISE EXCEPTION 'Enter a mark for each of the % questions.', v_nq;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_marks) m WHERE m IS NOT NULL AND m NOT IN (0, 0.5, 1)) THEN
      RAISE EXCEPTION 'Each question''s mark must be 0, 0.5 or 1.';
    END IF;
    v_marks := ARRAY(SELECT COALESCE(m, 0) FROM unnest(p_marks) WITH ORDINALITY AS u(m, i) ORDER BY i);
  END IF;

  UPDATE public.result_evaluations SET deleted_at = now()
   WHERE enrollment_id = p_enrollment_id AND deleted_at IS NULL
  RETURNING paper_id INTO v_old;

  INSERT INTO public.result_evaluations (enrollment_id, paper_id, status, marks, total_marks)
  VALUES (p_enrollment_id, v_paper,
          CASE WHEN p_mode = 'absent' THEN 'absent' ELSE 'evaluated' END,
          CASE WHEN p_mode = 'questions' THEN v_marks::numeric(2,1)[] END,
          CASE WHEN p_mode = 'total' THEN p_total END);

  PERFORM public.results_rescore_paper_core(v_paper);
  IF v_old IS NOT NULL AND v_old <> v_paper THEN
    PERFORM public.results_rescore_paper_core(v_old);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.results_upload_manual(uuid, text, jsonb, boolean),
  public.results_manual_entry(uuid, text, numeric, numeric[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.results_upload_manual(uuid, text, jsonb, boolean),
  public.results_manual_entry(uuid, text, numeric, numeric[]) TO authenticated;

COMMIT;
