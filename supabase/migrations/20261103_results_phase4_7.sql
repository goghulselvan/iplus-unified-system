-- Results module, Phases 4-7: skill analysis, AI feedback storage, release + staged
-- sending, integrity flags, awards, plus a few read RPCs and the portal results RPC.
--
-- Additive only: new tables and new functions. Two of OUR existing results functions
-- change:
--   * results_rescore_paper_core  CREATE OR REPLACE, started from the exact applied body
--                                 (checked against live 2026-11-01). It now also marks
--                                 AI feedback / school analysis Outdated for students
--                                 whose score changed. Everything else is unchanged.
--   * results_correct_answer      a NEW 4-argument overload that records a reason in
--                                 result_corrections; the 3-argument version is untouched.
-- No DROP. One ALTER of an existing table, approved separately by Goghul at apply time:
-- the email trigger on school_result_release is DISABLED (see below; reversible with
-- ENABLE TRIGGER). Rows in school_result_release are inserted / deleted by the
-- superadmin RPCs below.
--
--   result_ai_batches        one row per Claude Message Batch (AI feedback); one running
--                            batch per project x school at a time
--   result_feedback          AI feedback per enrolment (outdated after a score change)
--   result_school_analysis   AI analysis per school x project
--   result_send_batches      a staged email / WhatsApp send; nothing goes out until a
--   result_send_items        superadmin approves it in the results-send function
--   result_integrity_flags   suspicious patterns found by results_integrity_scan
--   result_award_rules       award rules (Goghul's classification, entered in the UI)
--   result_awards            awards from rules (recomputed) and manual awards (kept)
--   result_corrections       the reason given for each single-answer correction
--
-- Access: SELECT via RLS for managers / superadmins (send tables: superadmin only).
-- Writes go through SECURITY DEFINER RPCs, except award rules (manager CRUD via RLS,
-- limited columns).
-- AI tables are written by the results-feedback edge function with service_role.
--
-- !! school_result_release has a live AFTER INSERT trigger (trg_notify_results_released)
-- that calls the notify-results-released edge function through pg_net, which is meant
-- to EMAIL the school, outside the staged, superadmin-approved send flow ("No autonomous
-- sends"). This migration DISABLES it. To undo:
--   ALTER TABLE public.school_result_release ENABLE TRIGGER trg_notify_results_released;
-- (The deployed edge function itself is still callable with the public anon key; that is
-- handled outside this migration.)
--
-- SCALE LIMITS (authenticated statement_timeout = 8s; one PostgREST call = one statement):
--   * results_integrity_scan unnests every OMR answer in the project once (8k enrolments
--     x 50 questions = 400k cells) and runs six set-based checks. The same-wrong-answer
--     check is a self-join per school x paper x question x wrong option, so its cost
--     grows with (students in one school x paper)^2. Comfortable at today's ~8k
--     enrolments (largest school x class group ~75); at 100k+ enrolments, or single
--     school groups of several hundred, move the scan to service_role (edge function).
--   * results_allot_awards ranks every score once per rule (few rules x all scores).
--   * results_skill_summary unnests the answers of one class x olympiad (or more).
BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.result_ai_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES public.olympiad_projects(id),
  school_id              uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  kind                   text NOT NULL DEFAULT 'student_feedback' CHECK (kind IN ('student_feedback')),
  anthropic_batch_id     text,
  status                 text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','ended','collected','failed')),
  total                  int  NOT NULL DEFAULT 0,
  succeeded              int  NOT NULL DEFAULT 0,
  errored                int  NOT NULL DEFAULT 0,
  -- Students whose request errored / expired, kept so "Try again for these N students"
  -- survives a page reload.
  errored_enrollment_ids uuid[] NOT NULL DEFAULT '{}',
  error                  text,
  created_by             uuid DEFAULT auth.uid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  collected_at           timestamptz
);
CREATE INDEX result_ai_batches_project_idx ON public.result_ai_batches (project_id, created_at DESC);
-- At most one running ('submitted') batch per project x school (NULL school = project-wide),
-- so a double click can't pay for the same feedback twice.
CREATE UNIQUE INDEX result_ai_batches_one_running
  ON public.result_ai_batches (project_id, COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'submitted';

-- Feedback JSON: {"overall":"...","strengths":[{"skill":"...","feedback":"..."}],
--                 "focus_areas":[{"skill":"...","feedback":"..."}],"tips":["..."],"goals":["..."]}
CREATE TABLE public.result_feedback (
  enrollment_id uuid PRIMARY KEY REFERENCES public.portal_student_enrollments(id) ON DELETE CASCADE,
  feedback      jsonb NOT NULL CHECK (jsonb_typeof(feedback) = 'object' AND feedback ? 'overall'),
  model         text NOT NULL,
  batch_id      uuid REFERENCES public.result_ai_batches(id) ON DELETE SET NULL,
  outdated      boolean NOT NULL DEFAULT false,
  -- results_feedback_basis_hash() of the skills + grade the feedback was written from.
  -- Shown as Outdated when it no longer matches (covers skill-tag edits, and feedback
  -- collected after a re-score).
  basis_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_feedback_batch_idx ON public.result_feedback (batch_id);

CREATE TABLE public.result_school_analysis (
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.olympiad_projects(id),
  analysis   jsonb NOT NULL CHECK (jsonb_typeof(analysis) = 'object'),
  model      text NOT NULL,
  outdated   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, project_id)
);

CREATE TABLE public.result_send_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.olympiad_projects(id),
  channel     text NOT NULL CHECK (channel IN ('email','whatsapp')),
  test_target text,                 -- test mode: every item goes to this one address / number
  status      text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','sending','done')),
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz
);
CREATE INDEX result_send_batches_project_idx ON public.result_send_batches (project_id, created_at DESC);

CREATE TABLE public.result_send_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id   uuid NOT NULL REFERENCES public.result_send_batches(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE) so send history survives a school hard-delete.
  school_id  uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  target     text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error      text,
  sent_at    timestamptz,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, school_id)
);

CREATE TABLE public.result_integrity_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.olympiad_projects(id),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_code    text,
  olympiad_code text,
  flag_type     text NOT NULL CHECK (flag_type IN ('identical_answers','same_wrong_answers','low_score_variance',
                                                    'far_above_state','adjacent_copying','answer_distribution_bias')),
  severity      text NOT NULL CHECK (severity IN ('medium','high','critical')),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- always has "enrollmentIds"
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','investigating','verified','dismissed')),
  notes         text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  scan_id       uuid,
  -- type + school + class + olympiad + the students involved. A re-scan does not
  -- re-raise a pattern someone has already reviewed.
  fingerprint   text NOT NULL
);
CREATE INDEX result_integrity_flags_project_idx ON public.result_integrity_flags (project_id, status);
CREATE INDEX result_integrity_flags_fp_idx ON public.result_integrity_flags (project_id, fingerprint);

CREATE TABLE public.result_award_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.olympiad_projects(id),
  award_name    text NOT NULL CHECK (btrim(award_name) <> ''),
  level         text NOT NULL CHECK (level IN ('national','state','district','school')),
  rule_type     text NOT NULL CHECK (rule_type IN ('top_n','min_percentage')),
  value         numeric NOT NULL CHECK (value > 0),
  class_code    text REFERENCES public.classes(code),
  olympiad_code text CHECK (olympiad_code IN ('EPO','MPO','SPO','GKSSPO','LRPO','KidsPO')),
  sort_order    int NOT NULL DEFAULT 0,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT result_award_rules_value_kind_check CHECK (
    (rule_type = 'top_n' AND value = trunc(value)) OR (rule_type = 'min_percentage' AND value <= 100))
);

CREATE TABLE public.result_awards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.olympiad_projects(id),
  enrollment_id uuid NOT NULL REFERENCES public.portal_student_enrollments(id) ON DELETE CASCADE,
  award_name    text NOT NULL CHECK (btrim(award_name) <> ''),
  source        text NOT NULL CHECK (source IN ('rule','manual')),
  rule_id       uuid REFERENCES public.result_award_rules(id) ON DELETE SET NULL,
  removed       boolean NOT NULL DEFAULT false,
  notes         text,              -- why a manual award was given (kept when removed)
  removed_note  text,              -- why it was removed (results_remove_award)
  removed_by    uuid,
  removed_at    timestamptz,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX result_awards_rule_unique
  ON public.result_awards (project_id, enrollment_id, award_name) WHERE source = 'rule';
CREATE UNIQUE INDEX result_awards_manual_unique
  ON public.result_awards (project_id, enrollment_id, award_name) WHERE source = 'manual' AND NOT removed;
CREATE INDEX result_awards_enrollment_idx ON public.result_awards (enrollment_id);

CREATE TABLE public.result_corrections (
  id              bigserial PRIMARY KEY,
  evaluation_id   uuid NOT NULL REFERENCES public.result_evaluations(id),
  question_number int  NOT NULL,
  before_value    text,
  after_value     text,
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by      uuid DEFAULT auth.uid(),
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_corrections_evaluation_idx ON public.result_corrections (evaluation_id);

-- Touch + audit triggers (functions from the Phase 0 migration).
CREATE TRIGGER result_award_rules_touch BEFORE INSERT OR UPDATE ON public.result_award_rules
  FOR EACH ROW EXECUTE FUNCTION public.result_touch_updated();
CREATE TRIGGER result_awards_touch BEFORE INSERT OR UPDATE ON public.result_awards
  FOR EACH ROW EXECUTE FUNCTION public.result_touch_updated();

CREATE TRIGGER result_integrity_flags_audit AFTER INSERT OR UPDATE OR DELETE ON public.result_integrity_flags
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();
CREATE TRIGGER result_awards_audit AFTER INSERT OR UPDATE OR DELETE ON public.result_awards
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();
CREATE TRIGGER result_award_rules_audit AFTER INSERT OR UPDATE OR DELETE ON public.result_award_rules
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();
CREATE TRIGGER result_send_batches_audit AFTER INSERT OR UPDATE OR DELETE ON public.result_send_batches
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();

-- ---------------------------------------------------------------------------
-- (b) Skill analysis (SECURITY INVOKER; RLS decides what the caller sees)
-- ---------------------------------------------------------------------------
-- Credit per question exactly as results_rescore_paper_core scores it: grace = 1,
-- OMR = 1 if the answer equals the key, manual = the 0 / 0.5 / 1 mark. Questions with
-- no skill tag are left out of skill figures (they still count in the total score).

-- Per paper: answer key, grace flags and skill tag as arrays indexed by question number.
CREATE FUNCTION public.results_paper_skill_keys(p_paper_ids uuid[])
  RETURNS TABLE (paper_id uuid, keys text[], grace boolean[], skills text[])
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT qp.id,
         array_agg(q.correct_answer ORDER BY g.n),
         array_agg(COALESCE(q.is_grace, false) ORDER BY g.n),
         array_agg(NULLIF(btrim(q.skill_category), '') ORDER BY g.n)
    FROM public.question_papers qp
   CROSS JOIN LATERAL generate_series(1, qp.total_questions) AS g(n)
    LEFT JOIN public.questions q ON q.paper_id = qp.id AND q.question_number = g.n
   WHERE qp.id = ANY (p_paper_ids)
   GROUP BY qp.id
$$;

-- One student's credit per skill (grace = 1, OMR answer = key -> 1, manual = the mark).
-- Untagged questions are left out. Small per-student aggregate, so callers never sort
-- every answer cell of the project at once.
CREATE FUNCTION public.results_skill_credit(p_answers text[], p_marks numeric[], p_keys text[],
                                           p_grace boolean[], p_skills text[])
  RETURNS TABLE (skill text, correct numeric, total int, first_q int)
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT p_skills[g.n],
         sum(CASE
               WHEN p_grace[g.n] THEN 1
               WHEN p_answers IS NOT NULL THEN CASE WHEN p_answers[g.n] = p_keys[g.n] THEN 1 ELSE 0 END
               ELSE COALESCE(p_marks[g.n], 0)
             END)::numeric,
         count(*)::int,
         min(g.n)
    FROM generate_series(1, cardinality(p_skills)) AS g(n)
   WHERE p_skills[g.n] IS NOT NULL
   GROUP BY p_skills[g.n]
$$;

-- What a student's AI feedback is based on: grade + every "skill:correct/total", sorted.
CREATE FUNCTION public.results_basis_hash(p_grade text, p_answers text[], p_marks numeric[], p_keys text[],
                                         p_grace boolean[], p_skills text[])
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = public
AS $$
  SELECT md5(COALESCE(p_grade, '') || '|' ||
             COALESCE(string_agg(x.skill || ':' || x.correct::text || '/' || x.total::text, ';' ORDER BY x.skill), ''))
    FROM public.results_skill_credit(p_answers, p_marks, p_keys, p_grace, p_skills) x
$$;

-- Current basis hash of one evaluated student (NULL if not scored). The feedback function
-- stores this (or the bulk column below) in result_feedback.basis_hash.
CREATE FUNCTION public.results_feedback_basis_hash(p_enrollment_id uuid)
  RETURNS text
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT public.results_basis_hash(rs.grade, e.answers, e.marks, pk.keys, pk.grace, pk.skills)
    FROM public.result_scores rs
    JOIN public.result_evaluations e ON e.id = rs.evaluation_id
    JOIN public.results_paper_skill_keys(ARRAY(SELECT r2.paper_id FROM public.result_scores r2
                                                WHERE r2.enrollment_id = p_enrollment_id)) pk
      ON pk.paper_id = rs.paper_id
   WHERE rs.enrollment_id = p_enrollment_id
$$;

-- Feedback status per evaluated student: has_feedback, and is_outdated = marked outdated
-- by a re-score OR its basis_hash no longer matches the student's current one.
CREATE FUNCTION public.results_feedback_status(p_project_id uuid, p_school_id uuid DEFAULT NULL)
  RETURNS TABLE (enrollment_id uuid, has_feedback boolean, is_outdated boolean)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH sc AS (
    SELECT rs.enrollment_id, rs.evaluation_id, rs.paper_id, rs.grade
      FROM public.result_scores rs
     WHERE rs.project_id = p_project_id
       AND (p_school_id IS NULL OR rs.school_id = p_school_id)
  )
  SELECT sc.enrollment_id,
         f.enrollment_id IS NOT NULL,
         CASE WHEN f.enrollment_id IS NULL THEN false
              ELSE f.outdated OR f.basis_hash IS DISTINCT FROM
                   public.results_basis_hash(sc.grade, e.answers, e.marks, pk.keys, pk.grace, pk.skills) END
    FROM sc
    JOIN public.result_evaluations e ON e.id = sc.evaluation_id
    JOIN public.results_paper_skill_keys(ARRAY(SELECT DISTINCT s2.paper_id FROM sc s2)) pk ON pk.paper_id = sc.paper_id
    LEFT JOIN public.result_feedback f ON f.enrollment_id = sc.enrollment_id
   ORDER BY sc.enrollment_id
$$;

CREATE FUNCTION public.results_student_skills(p_enrollment_id uuid)
  RETURNS TABLE (skill text, correct numeric, total int, percentage int)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT x.skill, x.correct, x.total, round(x.correct * 100 / x.total)::int
    FROM public.result_evaluations e
    JOIN public.results_paper_skill_keys(ARRAY(SELECT e2.paper_id FROM public.result_evaluations e2
                                                WHERE e2.enrollment_id = p_enrollment_id
                                                  AND e2.deleted_at IS NULL)) pk ON pk.paper_id = e.paper_id
   CROSS JOIN LATERAL public.results_skill_credit(e.answers, e.marks, pk.keys, pk.grace, pk.skills) x
   WHERE e.enrollment_id = p_enrollment_id
     AND e.deleted_at IS NULL
     AND e.status = 'evaluated'
   ORDER BY x.first_q
$$;

-- Per-student skill rows for many students at once (the AI feedback function builds one
-- request per enrolment from these). p_only_needing_feedback: only evaluated students
-- with no result_feedback row, an outdated one, or one whose basis_hash no longer matches.
-- basis_hash (same on every row of a student) is what the feedback function must store.
CREATE FUNCTION public.results_bulk_student_skills(p_project_id uuid, p_school_id uuid DEFAULT NULL,
                                                   p_only_needing_feedback boolean DEFAULT true)
  RETURNS TABLE (enrollment_id uuid, class_code text, olympiad_code text, grade text,
                 skill text, correct numeric, total int, basis_hash text)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH sc AS (
    SELECT rs.enrollment_id, rs.evaluation_id, rs.paper_id, rs.class_code, rs.olympiad_code, rs.grade
      FROM public.result_scores rs
     WHERE rs.project_id = p_project_id
       AND (p_school_id IS NULL OR rs.school_id = p_school_id)
  ),
  -- Skill rows built once; the hash is the same formula as results_basis_hash, taken
  -- over those rows (students with no tagged question have no rows, so never appear).
  rows AS MATERIALIZED (
    SELECT sc.enrollment_id, sc.class_code, sc.olympiad_code, sc.grade, x.skill, x.correct, x.total, x.first_q
      FROM sc
      JOIN public.result_evaluations e ON e.id = sc.evaluation_id
      JOIN public.results_paper_skill_keys(ARRAY(SELECT DISTINCT s2.paper_id FROM sc s2)) pk ON pk.paper_id = sc.paper_id
     CROSS JOIN LATERAL public.results_skill_credit(e.answers, e.marks, pk.keys, pk.grace, pk.skills) x
  ),
  h AS MATERIALIZED (
    SELECT r.enrollment_id,
           md5(COALESCE(min(r.grade), '') || '|' ||
               string_agg(r.skill || ':' || r.correct::text || '/' || r.total::text, ';' ORDER BY r.skill)) AS h
      FROM rows r GROUP BY r.enrollment_id
  ),
  need AS MATERIALIZED (
    SELECT h.* FROM h
     WHERE NOT COALESCE(p_only_needing_feedback, true)
        OR NOT EXISTS (SELECT 1 FROM public.result_feedback f
                        WHERE f.enrollment_id = h.enrollment_id AND NOT f.outdated AND f.basis_hash = h.h)
  )
  SELECT r.enrollment_id, r.class_code, r.olympiad_code, r.grade, r.skill, r.correct, r.total, need.h
    FROM rows r
    JOIN need ON need.enrollment_id = r.enrollment_id
   ORDER BY r.enrollment_id, r.first_q
$$;

-- Pooled skill % (sum of credit / number of questions answered by all students).
--   p_school_id given: school_pct = that school, state_pct = every student in the
--     school's state (state = most common state digits of its students), students =
--     the school's students.
--   p_school_id NULL: project-wide; school_pct is NULL, state_pct holds the all-India
--     figure, students = all students.
--   p_class_code / p_olympiad_code NULL = all classes / olympiads.
CREATE FUNCTION public.results_skill_summary(p_project_id uuid, p_school_id uuid, p_class_code text, p_olympiad_code text)
  RETURNS TABLE (skill text, school_pct int, state_pct int, students int)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH sc AS (
    SELECT rs.enrollment_id, rs.evaluation_id, rs.paper_id, rs.school_id, rs.state_code
      FROM public.result_scores rs
     WHERE rs.project_id = p_project_id
       AND (p_class_code IS NULL OR rs.class_code = p_class_code)
       AND (p_olympiad_code IS NULL OR rs.olympiad_code = p_olympiad_code)
  ),
  home AS (
    SELECT mode() WITHIN GROUP (ORDER BY sc.state_code) AS st
      FROM sc WHERE p_school_id IS NOT NULL AND sc.school_id = p_school_id
  ),
  pool AS (
    SELECT sc.*, (sc.school_id IS NOT DISTINCT FROM p_school_id) AS mine,
           (sc.state_code = (SELECT home.st FROM home)) AS in_state
      FROM sc
     WHERE p_school_id IS NULL
        OR sc.school_id = p_school_id
        OR sc.state_code = (SELECT home.st FROM home)
  ),
  per_student AS (
    SELECT pool.mine, pool.in_state, x.skill, x.correct, x.total
      FROM pool
      JOIN public.result_evaluations e ON e.id = pool.evaluation_id
      JOIN public.results_paper_skill_keys(ARRAY(SELECT DISTINCT p2.paper_id FROM pool p2)) pk
        ON pk.paper_id = pool.paper_id
     CROSS JOIN LATERAL public.results_skill_credit(e.answers, e.marks, pk.keys, pk.grace, pk.skills) x
  )
  SELECT c.skill,
         CASE WHEN p_school_id IS NULL THEN NULL
              ELSE round(sum(c.correct) FILTER (WHERE c.mine) * 100
                         / NULLIF(sum(c.total) FILTER (WHERE c.mine), 0))::int END,
         CASE WHEN p_school_id IS NULL THEN round(sum(c.correct) * 100 / sum(c.total))::int
              ELSE round(sum(c.correct) FILTER (WHERE c.in_state) * 100
                         / NULLIF(sum(c.total) FILTER (WHERE c.in_state), 0))::int END,
         CASE WHEN p_school_id IS NULL THEN count(*)::int
              ELSE (count(*) FILTER (WHERE c.mine))::int END
    FROM per_student c
   GROUP BY c.skill
  HAVING p_school_id IS NULL OR count(*) FILTER (WHERE c.mine) > 0
   ORDER BY c.skill
$$;

-- ---------------------------------------------------------------------------
-- (c) Rescore core: same as 20261102, plus Outdated marking (section marked NEW)
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

CREATE FUNCTION public.results_correct_answer(p_evaluation_id uuid, p_question_number int, p_value text, p_reason text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ev     public.result_evaluations%ROWTYPE;
  v_paper  public.question_papers%ROWTYPE;
  v_before text;
  v_after  text;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Please give a reason for this correction.';
  END IF;
  -- Same lock order as the 3-argument version (group lock, then the row), so the
  -- "before" value read here is the one that gets replaced.
  SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id;
  IF FOUND THEN
    SELECT * INTO v_paper FROM public.question_papers WHERE id = v_ev.paper_id;
    IF FOUND THEN
      PERFORM public.results_lock_group(v_paper.project_id, v_paper.class_code, v_paper.olympiad_code);
      SELECT * INTO v_ev FROM public.result_evaluations WHERE id = p_evaluation_id FOR UPDATE;
      IF p_question_number BETWEEN 1 AND v_paper.total_questions THEN
        v_before := COALESCE(v_ev.answers[p_question_number], v_ev.marks[p_question_number]::text);
      END IF;
    END IF;
  END IF;

  -- All validation and the re-score happen here (raises with its own messages).
  PERFORM public.results_correct_answer(p_evaluation_id, p_question_number, p_value);

  SELECT COALESCE(e.answers[p_question_number], e.marks[p_question_number]::text) INTO v_after
    FROM public.result_evaluations e WHERE e.id = p_evaluation_id;
  INSERT INTO public.result_corrections (evaluation_id, question_number, before_value, after_value, reason)
  VALUES (p_evaluation_id, p_question_number, v_before, v_after, btrim(p_reason));
END
$$;

-- ---------------------------------------------------------------------------
-- (e) Release and staged sending (superadmin only)
-- ---------------------------------------------------------------------------

-- Locks every project x class x olympiad group these schools have scores in (ascending
-- key order, same as every other writer), so a rescore running at the same time sees
-- the release set either fully before or fully after (no false resend flags). A group
-- the school has no scores in yet isn't locked: a release that commits during the
-- school's first upload into that group can raise one resend flag (arguably correct).
CREATE FUNCTION public.results_lock_school_groups(p_project_id uuid, p_school_ids uuid[])
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  v_key bigint;
BEGIN
  FOR v_key IN
    SELECT DISTINCT public.results_group_key(rs.project_id, rs.class_code, rs.olympiad_code)
      FROM public.result_scores rs
     WHERE rs.project_id = p_project_id AND rs.school_id = ANY (p_school_ids)
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;
END
$$;

-- Returns the number of schools newly released (already released ones are skipped).
CREATE FUNCTION public.results_release_schools(p_project_id uuid, p_school_ids uuid[], p_notes text)
  RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_bad int;
  v_n   int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Only a superadmin can release results.';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.olympiad_projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'This project no longer exists.';
  END IF;
  IF p_school_ids IS NULL OR cardinality(p_school_ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_bad
    FROM (SELECT DISTINCT unnest(p_school_ids) AS id) i
   WHERE i.id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.portal_student_enrollments pe
                      WHERE pe.project_id = p_project_id AND pe.school_id = i.id);
  IF v_bad = 1 THEN
    RAISE EXCEPTION 'Nothing was released: 1 of the selected schools has no students in this project.';
  ELSIF v_bad > 1 THEN
    RAISE EXCEPTION 'Nothing was released: % of the selected schools have no students in this project.', v_bad;
  END IF;

  PERFORM public.results_lock_school_groups(p_project_id, p_school_ids);

  WITH ins AS (
    INSERT INTO public.school_result_release (school_id, project_id, released_by, notes)
    SELECT DISTINCT i.id, p_project_id, auth.uid(), NULLIF(btrim(p_notes), '')
      FROM unnest(p_school_ids) AS i(id)
    ON CONFLICT (school_id, project_id) DO NOTHING
    RETURNING *
  )
  INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
  SELECT 'school_result_release', ins.id, 'RELEASE', NULL, to_jsonb(ins) FROM ins;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

-- Takes a school's release back. The release row is deleted; a copy stays in
-- result_audit_log (action UNRELEASE). Returns 1 if it was released, else 0.
CREATE FUNCTION public.results_unrelease_school(p_project_id uuid, p_school_id uuid)
  RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Only a superadmin can release results.';
  END IF;
  PERFORM public.results_lock_school_groups(p_project_id, ARRAY[p_school_id]);

  WITH del AS (
    DELETE FROM public.school_result_release
     WHERE project_id = p_project_id AND school_id = p_school_id
    RETURNING *
  )
  INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
  SELECT 'school_result_release', del.id, 'UNRELEASE', to_jsonb(del), NULL FROM del;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Anything still waiting to go to this school is stopped (never sent automatically).
  UPDATE public.result_send_items i
     SET status = 'failed', error = 'School was unreleased before sending.'
    FROM public.result_send_batches b
   WHERE b.id = i.batch_id
     AND b.project_id = p_project_id
     AND b.status IN ('staged','sending')
     AND i.school_id = p_school_id
     AND i.status = 'pending';
  RETURN v_n;
END
$$;

-- Clears an open "Scores changed after release" flag. Returns false if it was already clear.
CREATE FUNCTION public.results_clear_resend_flag(p_flag_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_old public.result_resend_flags%ROWTYPE;
  v_new public.result_resend_flags%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Only a superadmin can release results.';
  END IF;
  SELECT * INTO v_old FROM public.result_resend_flags WHERE id = p_flag_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This resend flag no longer exists.';
  END IF;
  IF v_old.cleared_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE public.result_resend_flags
     SET cleared_at = now(), cleared_by = auth.uid()
   WHERE id = p_flag_id
  RETURNING * INTO v_new;
  INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
  VALUES ('result_resend_flags', p_flag_id, 'CLEAR', to_jsonb(v_old), to_jsonb(v_new));
  RETURN true;
END
$$;

-- Stages a send: one item per school. NOTHING is sent here; the results-send function
-- sends a staged batch only after a superadmin approves it. Test mode (p_test_target)
-- addresses every item to that one email / number. A school with no address on file is
-- staged as 'failed' with the reason, so the preview shows it.
CREATE FUNCTION public.results_stage_send(p_project_id uuid, p_channel text, p_school_ids uuid[], p_test_target text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_test  text := NULLIF(btrim(p_test_target), '');
  v_bad   int;
  v_batch uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Only a superadmin can send results.';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('email','whatsapp') THEN
    RAISE EXCEPTION 'Choose Email or WhatsApp.';
  END IF;
  IF p_school_ids IS NULL OR cardinality(array_remove(p_school_ids, NULL)) = 0 THEN
    RAISE EXCEPTION 'Choose at least one school to send to.';
  END IF;
  IF v_test IS NOT NULL THEN
    IF p_channel = 'email' AND v_test !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'The test address "%" is not a valid email address.', v_test;
    END IF;
    IF p_channel = 'whatsapp' THEN
      IF length(public.results_digits(v_test)) NOT IN (10, 12) THEN
        RAISE EXCEPTION 'The test number "%" is not a valid mobile number.', v_test;
      END IF;
      v_test := right(public.results_digits(v_test), 10);
    END IF;
  END IF;

  SELECT count(*) INTO v_bad
    FROM (SELECT DISTINCT unnest(array_remove(p_school_ids, NULL)) AS id) i
   WHERE NOT EXISTS (SELECT 1 FROM public.school_result_release r
                      WHERE r.project_id = p_project_id AND r.school_id = i.id);
  IF v_bad = 1 THEN
    RAISE EXCEPTION 'Nothing was staged: 1 of the selected schools hasn''t been released yet.';
  ELSIF v_bad > 1 THEN
    RAISE EXCEPTION 'Nothing was staged: % of the selected schools haven''t been released yet.', v_bad;
  END IF;

  INSERT INTO public.result_send_batches (project_id, channel, test_target)
  VALUES (p_project_id, p_channel, v_test)
  RETURNING id INTO v_batch;

  INSERT INTO public.result_send_items (batch_id, school_id, target, payload, status, error)
  SELECT v_batch, s.id, t.target,
         jsonb_build_object('schoolName', s.school_name, 'ssNo', s.ss_no, 'testMode', v_test IS NOT NULL,
                            'evaluated', (SELECT count(*) FROM public.result_scores rs
                                           WHERE rs.project_id = p_project_id AND rs.school_id = s.id)),
         CASE WHEN t.target IS NULL THEN 'failed' ELSE 'pending' END,
         CASE WHEN t.target IS NULL THEN
           CASE p_channel WHEN 'email' THEN 'This school has no email address on file.'
                          ELSE 'This school has no mobile number on file.' END
         END
    FROM public.schools s
   CROSS JOIN LATERAL (
          SELECT COALESCE(v_test,
                   CASE p_channel
                     WHEN 'email' THEN NULLIF(btrim(s.email), '')
                     ELSE CASE WHEN length(public.results_digits(s.mobile1)) >= 10
                               THEN right(public.results_digits(s.mobile1), 10) END
                   END) AS target) t
   WHERE s.id IN (SELECT unnest(p_school_ids));
  RETURN v_batch;
END
$$;

-- ---------------------------------------------------------------------------
-- (f) Integrity scan (managers)
-- ---------------------------------------------------------------------------
-- Groups are school x paper (= school x class x olympiad x slot). Answer-based checks
-- use OMR answers only; LKG-Class 2 (manual marks) get only the score-based checks.
--   identical_answers        >= 3 identical full answer strings (at least half answered)
--                            -> medium; >= 5 high; >= 10 critical
--   same_wrong_answers       pairs where both have >= 5 wrong answers and the same wrong
--                            option on >= 60% of the larger wrong count -> high; >= 80%
--                            critical (grace questions never count as wrong). One flag
--                            per school x paper listing the pairs (first 100).
--   low_score_variance       >= 10 students, population stddev of % < 3 -> high; < 2 critical
--   far_above_state          school x class x olympiad with >= 5 students, average >= 20
--                            points above the rest of its state (>= 5 other students in
--                            the same state, class, olympiad) -> high; >= 30 critical
--   adjacent_copying         consecutive registration numbers (roll +1) in the same group
--                            with >= 90% identical answers (same answered option / number
--                            of questions); a chain of 2 students -> high, >= 3 critical
--   answer_distribution_bias one option > 60% of all answers given by a group of >= 5
--                            students -> medium (details include the key's own share)
-- A re-scan deletes the pending flags and inserts the new ones; flags under review /
-- verified / dismissed are kept, and a new flag with the same fingerprint as a kept
-- one is not raised again.
CREATE FUNCTION public.results_integrity_scan(p_project_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
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
         (q.is_grace IS NOT TRUE AND q.correct_answer IS NOT NULL AND s.answers[g.n] <> q.correct_answer)
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
$$;

-- Review workflow: Pending -> Investigating -> Verified / Dismissed (note required for
-- Verified and Dismissed). Setting it back to Pending is allowed (the next scan replaces it).
CREATE FUNCTION public.results_review_integrity_flag(p_flag_id uuid, p_status text, p_notes text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending','investigating','verified','dismissed') THEN
    RAISE EXCEPTION 'Choose Pending, Investigating, Verified or Dismissed.';
  END IF;
  IF p_status IN ('verified','dismissed') AND NULLIF(btrim(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Add a note saying why this flag is %.', initcap(p_status);
  END IF;
  UPDATE public.result_integrity_flags
     SET status = p_status,
         notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_flag_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This flag no longer exists. Run the scan again.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- (g) Awards (managers)
-- ---------------------------------------------------------------------------
-- Recomputes the source='rule' awards from result_award_rules over result_scores:
--   * top_n: RANK() by total within class x olympiad (+ state / district / school for
--     those levels) over ELIGIBLE students only, rank <= N; ties all get the award.
--   * min_percentage: percentage >= value.
--   * One rule award per enrolment: the matching rule with the lowest sort_order wins
--     (so % bands like Gold >= 90, Silver >= 80 don't stack). A student whose rule is
--     taken by an earlier rule still occupies their rank for later top_n rules.
--   * Students of schools with a Verified integrity flag are not eligible; those schools
--     come back in manualReview.
-- Manual awards are never touched. A rule award a person marked removed stays removed
-- while the rule still gives it, even if the rule is renamed (rows are matched to the
-- wanted award by rule_id first, then by award name); one the rules no longer give is
-- deleted.
CREATE FUNCTION public.results_allot_awards(p_project_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_deleted int;
  v_res     jsonb;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('results_awards|' || p_project_id::text, 0));

  CREATE TEMPORARY TABLE IF NOT EXISTS results_award_want (
    enrollment_id uuid, award_name text, rule_id uuid
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.results_award_want;

  INSERT INTO pg_temp.results_award_want
  WITH excluded AS (
    SELECT DISTINCT f.school_id FROM public.result_integrity_flags f
     WHERE f.project_id = p_project_id AND f.status = 'verified'
  ),
  elig AS (
    SELECT rs.* FROM public.result_scores rs
     WHERE rs.project_id = p_project_id
       AND (rs.school_id IS NULL OR rs.school_id NOT IN (SELECT excluded.school_id FROM excluded))
  ),
  hits AS (
    SELECT r.id AS rule_id, btrim(r.award_name) AS award_name, r.sort_order, x.enrollment_id
      FROM public.result_award_rules r
     CROSS JOIN LATERAL (
            SELECT y.enrollment_id
              FROM (SELECT e.enrollment_id, e.percentage,
                           rank() OVER (PARTITION BY e.class_code, e.olympiad_code,
                                          CASE r.level WHEN 'national' THEN ''
                                                       WHEN 'state'    THEN e.state_code
                                                       WHEN 'district' THEN e.district_key
                                                       ELSE e.school_id::text END
                                        ORDER BY e.total DESC) AS rk
                      FROM elig e
                     WHERE (r.class_code IS NULL OR e.class_code = r.class_code)
                       AND (r.olympiad_code IS NULL OR e.olympiad_code = r.olympiad_code)
                       AND (r.level <> 'school' OR e.school_id IS NOT NULL)) y
             WHERE (r.rule_type = 'top_n' AND y.rk <= r.value)
                OR (r.rule_type = 'min_percentage' AND y.percentage >= r.value)
          ) x
     WHERE r.project_id = p_project_id
  )
  SELECT DISTINCT ON (h.enrollment_id) h.enrollment_id, h.award_name, h.rule_id
    FROM hits h
   ORDER BY h.enrollment_id, h.sort_order, h.award_name, h.rule_id;

  -- 1. Drop rule rows that match no wanted award (by rule or by name) for that student.
  DELETE FROM public.result_awards a
   WHERE a.project_id = p_project_id
     AND a.source = 'rule'
     AND NOT EXISTS (SELECT 1 FROM pg_temp.results_award_want w
                      WHERE w.enrollment_id = a.enrollment_id
                        AND (w.rule_id = a.rule_id OR w.award_name = a.award_name));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2. If a student has both a row from the wanted rule and a same-name row from another
  --    rule, keep the wanted rule's row (it carries any "removed" decision).
  DELETE FROM public.result_awards a
   USING pg_temp.results_award_want w
   WHERE a.project_id = p_project_id
     AND a.source = 'rule'
     AND w.enrollment_id = a.enrollment_id
     AND a.rule_id IS DISTINCT FROM w.rule_id
     AND EXISTS (SELECT 1 FROM public.result_awards b
                  WHERE b.project_id = p_project_id AND b.source = 'rule'
                    AND b.enrollment_id = a.enrollment_id AND b.rule_id = w.rule_id);

  -- 3. Bring the kept rows up to date (a renamed rule renames its awards; removed stays).
  UPDATE public.result_awards a
     SET award_name = w.award_name, rule_id = w.rule_id
    FROM pg_temp.results_award_want w
   WHERE a.project_id = p_project_id
     AND a.source = 'rule'
     AND w.enrollment_id = a.enrollment_id
     AND (w.rule_id = a.rule_id OR w.award_name = a.award_name)
     AND (a.award_name, a.rule_id) IS DISTINCT FROM (w.award_name, w.rule_id);

  -- 4. New awards.
  INSERT INTO public.result_awards (project_id, enrollment_id, award_name, source, rule_id)
  SELECT p_project_id, w.enrollment_id, w.award_name, 'rule', w.rule_id
    FROM pg_temp.results_award_want w
   WHERE NOT EXISTS (SELECT 1 FROM public.result_awards a
                      WHERE a.project_id = p_project_id AND a.source = 'rule'
                        AND a.enrollment_id = w.enrollment_id)
  ON CONFLICT (project_id, enrollment_id, award_name) WHERE source = 'rule' DO NOTHING;

  SELECT jsonb_build_object(
           'awarded', (SELECT count(*) FROM public.result_awards a
                        WHERE a.project_id = p_project_id AND a.source = 'rule' AND NOT a.removed),
           'removedKept', (SELECT count(*) FROM public.result_awards a
                            WHERE a.project_id = p_project_id AND a.source = 'rule' AND a.removed),
           'deleted', v_deleted,
           'byAward', COALESCE((SELECT jsonb_agg(jsonb_build_object('award', z.award_name, 'students', z.k)
                                                 ORDER BY z.so, z.award_name)
                                  FROM (SELECT a.award_name, count(*) AS k,
                                               min(COALESCE(r.sort_order, 2147483647)) AS so
                                          FROM public.result_awards a
                                          LEFT JOIN public.result_award_rules r ON r.id = a.rule_id
                                         WHERE a.project_id = p_project_id AND a.source = 'rule' AND NOT a.removed
                                         GROUP BY a.award_name) z), '[]'::jsonb),
           'manualReview', COALESCE((SELECT jsonb_agg(jsonb_build_object('schoolId', z.school_id,
                                                                         'schoolName', sc.school_name,
                                                                         'verifiedFlags', z.k)
                                                      ORDER BY sc.school_name, z.school_id)
                                       FROM (SELECT f.school_id, count(*) AS k
                                               FROM public.result_integrity_flags f
                                              WHERE f.project_id = p_project_id AND f.status = 'verified'
                                              GROUP BY f.school_id) z
                                       LEFT JOIN public.schools sc ON sc.id = z.school_id), '[]'::jsonb))
    INTO v_res;
  TRUNCATE pg_temp.results_award_want;
  RETURN v_res;
END
$$;

-- Manual awards (managers). A note is required to add or remove one.
CREATE FUNCTION public.results_add_manual_award(p_project_id uuid, p_enrollment_id uuid, p_award_name text, p_note text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF NULLIF(btrim(p_award_name), '') IS NULL THEN
    RAISE EXCEPTION 'Please give the award a name.';
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Please add a note for this award.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_student_enrollments pe
                  WHERE pe.id = p_enrollment_id AND pe.project_id = p_project_id) THEN
    RAISE EXCEPTION 'This student is not registered in this project.';
  END IF;
  BEGIN
    INSERT INTO public.result_awards (project_id, enrollment_id, award_name, source, notes)
    VALUES (p_project_id, p_enrollment_id, btrim(p_award_name), 'manual', btrim(p_note))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This student already has this award.';
  END;
  RETURN v_id;
END
$$;

-- Removes a rule or manual award (soft: removed = true). The original notes are kept.
CREATE FUNCTION public.results_remove_award(p_award_id uuid, p_note text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Please add a note for this award.';
  END IF;
  UPDATE public.result_awards
     SET removed = true, removed_note = btrim(p_note), removed_by = auth.uid(), removed_at = now()
   WHERE id = p_award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This award no longer exists.';
  END IF;
END
$$;

CREATE FUNCTION public.results_restore_award(p_award_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers can do this.';
  END IF;
  BEGIN
    UPDATE public.result_awards SET removed = false WHERE id = p_award_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This award no longer exists.';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This student already has this award.';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- (h) Read RPCs (SECURITY INVOKER, STABLE) and the portal RPC
-- ---------------------------------------------------------------------------

-- Find a student by registration number (any spacing / hyphens). Uses
-- pse_results_reg_digits_idx.
CREATE FUNCTION public.results_find_enrollment(p_project_id uuid, p_reg text)
  RETURNS TABLE (enrollment_id uuid, registration_number text, student_name text, school_name text,
                 class_code text, olympiad_code text)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT pe.id, pe.registration_number, st.student_name, sc.school_name, st.class_code, pe.olympiad_code
    FROM public.portal_student_enrollments pe
    JOIN public.portal_registered_students st ON st.id = pe.student_id
    LEFT JOIN public.schools sc ON sc.id = pe.school_id
   WHERE pe.project_id = p_project_id
     AND public.results_digits(pe.registration_number) = NULLIF(public.results_digits(p_reg), '')
   ORDER BY pe.registration_number, pe.id
$$;

-- Class x olympiad pairs that have scores (Rankings page picker).
CREATE FUNCTION public.results_score_combinations(p_project_id uuid)
  RETURNS TABLE (class_code text, olympiad_code text, students int)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT rs.class_code, rs.olympiad_code, count(*)::int
    FROM public.result_scores rs
   WHERE rs.project_id = p_project_id
   GROUP BY rs.class_code, rs.olympiad_code
   ORDER BY CASE WHEN rs.class_code IN ('14','15') THEN 0 ELSE 1 END, rs.class_code,
            array_position(ARRAY['EPO','MPO','SPO','GKSSPO','LRPO','KidsPO'], rs.olympiad_code)
$$;

-- Every school x class x olympiad with enrolments: registered / evaluated / absent /
-- pending, counted exactly as results_class_olympiad_summary does, in one query.
CREATE FUNCTION public.results_registered_vs_evaluated(p_project_id uuid)
  RETURNS TABLE (school_id uuid, school_name text, class_code text, olympiad_code text,
                 registered int, evaluated int, absent int, pending int)
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  WITH g AS (
    SELECT pe.school_id, st.class_code, pe.olympiad_code,
           count(*) AS registered,
           count(*) FILTER (WHERE ev.status = 'evaluated') AS evaluated,
           count(*) FILTER (WHERE ev.status = 'absent') AS absent
      FROM public.portal_student_enrollments pe
      JOIN public.portal_registered_students st ON st.id = pe.student_id
      LEFT JOIN public.result_evaluations ev ON ev.enrollment_id = pe.id AND ev.deleted_at IS NULL
     WHERE pe.project_id = p_project_id
       AND pe.school_id IS NOT NULL
     GROUP BY pe.school_id, st.class_code, pe.olympiad_code
  )
  SELECT g.school_id, sc.school_name, g.class_code, g.olympiad_code,
         g.registered::int, g.evaluated::int, g.absent::int, (g.registered - g.evaluated - g.absent)::int
    FROM g
    LEFT JOIN public.schools sc ON sc.id = g.school_id
   ORDER BY sc.school_name, g.school_id,
            CASE WHEN g.class_code IN ('14','15') THEN 0 ELSE 1 END, g.class_code,
            array_position(ARRAY['EPO','MPO','SPO','GKSSPO','LRPO','KidsPO'], g.olympiad_code)
$$;

-- School portal: the signed-in school's scores, ONLY once that school is released.
-- The school comes from get_portal_school_id() (school_portal_accounts, active row),
-- the same mapping the portal's own RLS uses. Anyone else gets no rows.
CREATE FUNCTION public.portal_school_results(p_project_id uuid)
  RETURNS TABLE (enrollment_id uuid, registration_number text, student_name text,
                 class_code text, olympiad_code text, total numeric, max_marks int,
                 percentage int, grade text, rank_school int, rank_district int,
                 rank_state int, rank_national int)
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  WITH me AS (SELECT public.get_portal_school_id() AS school_id)
  SELECT rs.enrollment_id, pe.registration_number, st.student_name,
         rs.class_code, rs.olympiad_code, rs.total, rs.max_marks, rs.percentage, rs.grade,
         rs.rank_school, rs.rank_district, rs.rank_state, rs.rank_national
    FROM me
    JOIN public.portal_student_enrollments pe ON pe.school_id = me.school_id AND pe.project_id = p_project_id
    JOIN public.result_scores rs ON rs.enrollment_id = pe.id
    JOIN public.portal_registered_students st ON st.id = pe.student_id
   WHERE EXISTS (SELECT 1 FROM public.school_result_release r
                  WHERE r.project_id = p_project_id AND r.school_id = me.school_id)
   ORDER BY CASE WHEN rs.class_code IN ('14','15') THEN 0 ELSE 1 END, rs.class_code,
            array_position(ARRAY['EPO','MPO','SPO','GKSSPO','LRPO','KidsPO'], rs.olympiad_code),
            rs.rank_school, pe.registration_number
$$;

-- ---------------------------------------------------------------------------
-- (i) Row-level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE public.result_ai_batches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_school_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_send_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_send_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_integrity_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_award_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_awards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_corrections     ENABLE ROW LEVEL SECURITY;

CREATE POLICY results_select_ai_batches ON public.result_ai_batches FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_feedback ON public.result_feedback FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_school_analysis ON public.result_school_analysis FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_send_batches ON public.result_send_batches FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin'));
CREATE POLICY results_select_send_items ON public.result_send_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'superadmin'));
CREATE POLICY results_select_integrity_flags ON public.result_integrity_flags FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_corrections ON public.result_corrections FOR SELECT
  USING (public.is_manager_or_superadmin());

CREATE POLICY results_select_award_rules ON public.result_award_rules FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_insert_award_rules ON public.result_award_rules FOR INSERT
  WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_update_award_rules ON public.result_award_rules FOR UPDATE
  USING (public.is_manager_or_superadmin()) WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_delete_award_rules ON public.result_award_rules FOR DELETE
  USING (public.is_manager_or_superadmin());

CREATE POLICY results_select_awards ON public.result_awards FOR SELECT
  USING (public.is_manager_or_superadmin());

REVOKE ALL ON public.result_ai_batches, public.result_feedback, public.result_school_analysis,
              public.result_send_batches, public.result_send_items, public.result_integrity_flags,
              public.result_award_rules, public.result_awards, public.result_corrections FROM anon;
REVOKE ALL ON public.result_ai_batches, public.result_feedback, public.result_school_analysis,
              public.result_send_batches, public.result_send_items, public.result_integrity_flags,
              public.result_award_rules, public.result_awards, public.result_corrections FROM authenticated;
GRANT SELECT ON public.result_ai_batches, public.result_feedback, public.result_school_analysis,
                public.result_send_batches, public.result_send_items, public.result_integrity_flags,
                public.result_award_rules, public.result_awards, public.result_corrections TO authenticated;
GRANT INSERT (project_id, award_name, level, rule_type, value, class_code, olympiad_code, sort_order),
      UPDATE (award_name, level, rule_type, value, class_code, olympiad_code, sort_order),
      DELETE ON public.result_award_rules TO authenticated;
-- result_awards: read-only for staff; manual add / remove / restore go through RPCs.
REVOKE ALL ON SEQUENCE public.result_corrections_id_seq FROM anon, authenticated;
-- A correction must carry a reason: the 4-argument version is the only client path. It
-- calls the 3-argument one as owner, so that keeps working.
REVOKE EXECUTE ON FUNCTION public.results_correct_answer(uuid, int, text) FROM authenticated;

REVOKE ALL ON FUNCTION
  public.results_paper_skill_keys(uuid[]),
  public.results_skill_credit(text[], numeric[], text[], boolean[], text[]),
  public.results_basis_hash(text, text[], numeric[], text[], boolean[], text[]),
  public.results_feedback_basis_hash(uuid),
  public.results_feedback_status(uuid, uuid),
  public.results_student_skills(uuid),
  public.results_skill_summary(uuid, uuid, text, text),
  public.results_bulk_student_skills(uuid, uuid, boolean),
  public.results_correct_answer(uuid, int, text, text),
  public.results_lock_school_groups(uuid, uuid[]),
  public.results_release_schools(uuid, uuid[], text),
  public.results_unrelease_school(uuid, uuid),
  public.results_clear_resend_flag(uuid),
  public.results_stage_send(uuid, text, uuid[], text),
  public.results_integrity_scan(uuid),
  public.results_review_integrity_flag(uuid, text, text),
  public.results_allot_awards(uuid),
  public.results_add_manual_award(uuid, uuid, text, text),
  public.results_remove_award(uuid, text),
  public.results_restore_award(uuid),
  public.results_find_enrollment(uuid, text),
  public.results_score_combinations(uuid),
  public.results_registered_vs_evaluated(uuid),
  public.portal_school_results(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  -- the two skill helpers are SECURITY INVOKER (questions RLS still applies), so the
  -- invoker RPCs that use them need the caller to hold EXECUTE.
  public.results_paper_skill_keys(uuid[]),
  public.results_skill_credit(text[], numeric[], text[], boolean[], text[]),
  public.results_basis_hash(text, text[], numeric[], text[], boolean[], text[]),
  public.results_feedback_basis_hash(uuid),
  public.results_feedback_status(uuid, uuid),
  public.results_student_skills(uuid),
  public.results_skill_summary(uuid, uuid, text, text),
  public.results_bulk_student_skills(uuid, uuid, boolean),
  public.results_correct_answer(uuid, int, text, text),
  public.results_release_schools(uuid, uuid[], text),
  public.results_unrelease_school(uuid, uuid),
  public.results_clear_resend_flag(uuid),
  public.results_stage_send(uuid, text, uuid[], text),
  public.results_integrity_scan(uuid),
  public.results_review_integrity_flag(uuid, text, text),
  public.results_allot_awards(uuid),
  public.results_add_manual_award(uuid, uuid, text, text),
  public.results_remove_award(uuid, text),
  public.results_restore_award(uuid),
  public.results_find_enrollment(uuid, text),
  public.results_score_combinations(uuid),
  public.results_registered_vs_evaluated(uuid),
  public.portal_school_results(uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- (j) Stop the release-time email (see header). Reversible with ENABLE TRIGGER.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_result_release DISABLE TRIGGER trg_notify_results_released;

COMMIT;
