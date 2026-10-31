-- Results module, Phase 0: foundation schema.
--
-- The CRM database still holds 11 tables left over from the earlier Lovable
-- unification (question_papers, questions, student_responses, ...). They are all
-- EMPTY (0 rows each, checked 2026-11-01) and have the wrong shape for the new
-- Results module, so they are dropped and rebuilt:
--   * question_papers / questions  - new shape (class x olympiad x slot, soft delete)
--   * result_skill_lists           - skill names the AI may tag questions with
--   * result_audit_log             - every change to papers and questions
--
-- Safety: the first statement refuses to run if any of the 11 tables has a row,
-- and the whole file is one transaction, so a failure part-way changes nothing.
--
-- Two things outside those tables reference them by name inside function bodies
-- (Postgres does not track that, so the DROP would succeed and the functions
-- would then fail at call time):
--   * school_removal_blockers(uuid, uuid) - used by the live "Remove from project"
--     dialog. Re-created below WITHOUT its 'results' line (it counted
--     result_students); everything else in it is identical.
--   * 13 dormant functions (old result reports / rankings / name stripping). Nothing
--     in this repo calls them; they only ran through the old relay. Dropped with
--     plain DROP FUNCTION (no CASCADE). Originals are saved in
--     Claude-workspace/backups/2026-11-01_results_dropped_functions.sql, and the
--     table definitions in 2026-11-01_results_dropped_tables_schema.sql.
--
-- school_result_release is left untouched. Access to all new tables is limited to
-- public.is_manager_or_superadmin().
BEGIN;

-- (a0) Block writers on the old tables until COMMIT so a row cannot slip in between the check and the drop.
LOCK TABLE public.question_papers, public.questions, public.student_responses, public.student_skill_analysis,
           public.student_reports, public.analysis_jobs, public.result_students, public.olympiad_results,
           public.school_analysis, public.awards, public.school_flags IN ACCESS EXCLUSIVE MODE;

-- (a) Safety stop: refuse to drop anything that holds data.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['question_papers','questions','student_responses','student_skill_analysis',
                           'student_reports','analysis_jobs','result_students','olympiad_results',
                           'school_analysis','awards','school_flags'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'Refusing to drop public.%: it has % row(s)', t, n;
      END IF;
    END IF;
  END LOOP;
END
$$;

-- (b1) Stop the live function from reading a table that is about to go away.
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
    'invoices',        NULLIF((SELECT count(*) FROM invoices WHERE school_id = p_school_id), 0)
  ))
$function$;

-- (b2) Drop the 11 empty leftover tables (children first). No CASCADE.
DROP TABLE public.student_responses;
DROP TABLE public.student_skill_analysis;
DROP TABLE public.student_reports;
DROP TABLE public.awards;
DROP TABLE public.school_flags;
DROP TABLE public.school_analysis;
DROP TABLE public.analysis_jobs;
DROP TABLE public.olympiad_results;
DROP TABLE public.result_students;
DROP TABLE public.questions;
DROP TABLE public.question_papers;

-- (b3) Drop the 13 dormant functions that only served those tables.
DROP FUNCTION public.audit_student_results_access();
DROP FUNCTION public.get_evaluated_students_count();
DROP FUNCTION public.get_rankings(text, integer);
DROP FUNCTION public.get_result_schools();
DROP FUNCTION public.get_results_paginated(text, integer, integer);
DROP FUNCTION public.get_school_class_subject_stats(uuid);
DROP FUNCTION public.get_school_evaluated_count(uuid);
DROP FUNCTION public.get_school_registration_evaluation_stats();
DROP FUNCTION public.get_school_statistics();
DROP FUNCTION public.get_school_student_counts(text, integer);
DROP FUNCTION public.strip_student_names_from_feedback();
DROP FUNCTION public.trg_sanitize_student_report();
DROP FUNCTION public.trg_sanitize_student_skill();

-- (c) New tables.
CREATE TABLE public.question_papers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.olympiad_projects(id),
  class_code       text NOT NULL REFERENCES public.classes(code),
  olympiad_code    text NOT NULL CHECK (olympiad_code IN ('EPO','MPO','SPO','GKSSPO','LRPO','KidsPO')),
  slot_template_id uuid NOT NULL REFERENCES public.exam_slot_templates(id),
  total_questions  int  NOT NULL CHECK (total_questions > 0),
  pdf_r2_key       text,
  pdf_file_name    text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  analysis_status  text NOT NULL DEFAULT 'none' CHECK (analysis_status IN ('none','running','done','failed')),
  analysis_progress int NOT NULL DEFAULT 0 CHECK (analysis_progress BETWEEN 0 AND 100),
  analysis_error   text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  -- LKG/UKG (14, 15) sit only the Kids olympiad; every other class never does.
  CONSTRAINT question_papers_kids_check CHECK ((class_code IN ('14','15')) = (olympiad_code = 'KidsPO'))
);

-- One live paper per project + class + olympiad + slot; soft-deleted rows don't count.
CREATE UNIQUE INDEX question_papers_live_unique
  ON public.question_papers (project_id, class_code, olympiad_code, slot_template_id)
  WHERE deleted_at IS NULL;

CREATE TABLE public.questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id          uuid NOT NULL REFERENCES public.question_papers(id) ON DELETE CASCADE,
  question_number   int  NOT NULL CHECK (question_number >= 1),
  question_text     text,
  has_figure        boolean NOT NULL DEFAULT false,
  correct_answer    text CHECK (correct_answer IN ('A','B','C','D')),
  is_grace          boolean NOT NULL DEFAULT false,
  skill_category    text,
  skill_description text,
  nep_skill_mapping text,
  cognitive_level   text CHECK (cognitive_level IN ('Remember','Understand','Apply','Analyze','Evaluate','Create')),
  ai_confidence     numeric(3,2),
  human_edited      boolean NOT NULL DEFAULT false,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, question_number)
  -- No "answer required" CHECK on purpose: a draft may have gaps; readiness is
  -- enforced in the app when a paper is marked Ready.
);

CREATE TABLE public.result_skill_lists (
  olympiad_code text NOT NULL CHECK (olympiad_code IN ('EPO','MPO','SPO','GKSSPO','LRPO','KidsPO')),
  class_group   text NOT NULL CHECK (class_group IN ('lkg_ukg','class_1_2','class_3_5','class_6_8')),
  skill         text NOT NULL,
  sort_order    int  NOT NULL,
  PRIMARY KEY (olympiad_code, class_group, skill)
);

CREATE TABLE public.result_audit_log (
  id         bigserial PRIMARY KEY,
  table_name text NOT NULL,
  row_id     uuid,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX result_audit_log_row_idx ON public.result_audit_log (table_name, row_id);

-- updated_at / updated_by maintenance.
CREATE FUNCTION public.result_touch_updated() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END
$$;

CREATE TRIGGER question_papers_touch BEFORE UPDATE ON public.question_papers
  FOR EACH ROW EXECUTE FUNCTION public.result_touch_updated();
CREATE TRIGGER questions_touch BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.result_touch_updated();

-- Audit trail. SECURITY DEFINER because staff have SELECT-only access to the log.
CREATE FUNCTION public.result_audit() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
    VALUES (TG_TABLE_NAME, NEW.id, TG_OP, NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
    VALUES (TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
  ELSE
    INSERT INTO public.result_audit_log (table_name, row_id, action, before, after)
    VALUES (TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD), NULL);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER question_papers_audit AFTER INSERT OR UPDATE OR DELETE ON public.question_papers
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();
CREATE TRIGGER questions_audit AFTER INSERT OR UPDATE OR DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.result_audit();

-- Row-level security: managers and superadmins only.
ALTER TABLE public.question_papers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_skill_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_audit_log  ENABLE ROW LEVEL SECURITY;

CREATE POLICY results_select_question_papers ON public.question_papers FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_insert_question_papers ON public.question_papers FOR INSERT
  WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_update_question_papers ON public.question_papers FOR UPDATE
  USING (public.is_manager_or_superadmin()) WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_delete_question_papers ON public.question_papers FOR DELETE
  USING (public.is_manager_or_superadmin());

CREATE POLICY results_select_questions ON public.questions FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_insert_questions ON public.questions FOR INSERT
  WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_update_questions ON public.questions FOR UPDATE
  USING (public.is_manager_or_superadmin()) WITH CHECK (public.is_manager_or_superadmin());
CREATE POLICY results_delete_questions ON public.questions FOR DELETE
  USING (public.is_manager_or_superadmin());

CREATE POLICY results_select_skill_lists ON public.result_skill_lists FOR SELECT
  USING (public.is_manager_or_superadmin());
CREATE POLICY results_select_audit_log ON public.result_audit_log FOR SELECT
  USING (public.is_manager_or_superadmin());

-- Privileges: the public (anon) key must not touch any of these; signed-in staff
-- can only read the skill lists and the audit log (writes go via seed / trigger).
REVOKE ALL ON public.result_audit_log, public.result_skill_lists, public.question_papers, public.questions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.result_audit_log, public.result_skill_lists FROM authenticated;

-- (d) Seed the skill lists. EPO/MPO/SPO/GKSSPO for classes 1-8 and KidsPO for
-- LKG/UKG are copied exactly from the old app's analyze-skills function
-- (SKILLS_BY_CLASS_SUBJECT: subject 1=EPO, 2=MPO, 3=SPO, 4=GKSSPO; lkg_ukg list 5 = KidsPO).
-- LRPO is the DRAFT list from the design spec, Appendix A. Classes 9-12 are not seeded.
INSERT INTO public.result_skill_lists (olympiad_code, class_group, skill, sort_order) VALUES
  ('EPO','class_1_2','Alphabet & Phonics',1),
  ('EPO','class_1_2','Reading Comprehension',2),
  ('EPO','class_1_2','Grammar Basics',3),
  ('EPO','class_1_2','Vocabulary Building',4),
  ('EPO','class_1_2','Sentence Formation',5),
  ('EPO','class_1_2','Spelling',6),
  ('EPO','class_1_2','Listening & Speaking',7),
  ('EPO','class_1_2','Creative Writing',8),
  ('MPO','class_1_2','Number Systems',1),
  ('MPO','class_1_2','Addition & Subtraction',2),
  ('MPO','class_1_2','Shapes & Geometry',3),
  ('MPO','class_1_2','Patterns & Sequences',4),
  ('MPO','class_1_2','Measurement',5),
  ('MPO','class_1_2','Time & Calendar',6),
  ('MPO','class_1_2','Data Handling',7),
  ('MPO','class_1_2','Word Problems',8),
  ('SPO','class_1_2','Plants & Animals',1),
  ('SPO','class_1_2','Human Body',2),
  ('SPO','class_1_2','Water & Air',3),
  ('SPO','class_1_2','Food & Nutrition',4),
  ('SPO','class_1_2','Weather & Seasons',5),
  ('SPO','class_1_2','Materials Around Us',6),
  ('SPO','class_1_2','Living vs Non-Living',7),
  ('GKSSPO','class_1_2','My Country',1),
  ('GKSSPO','class_1_2','Famous Places',2),
  ('GKSSPO','class_1_2','Animals & Birds',3),
  ('GKSSPO','class_1_2','Festivals & Culture',4),
  ('GKSSPO','class_1_2','Sports & Games',5),
  ('GKSSPO','class_1_2','Community Helpers',6),
  ('GKSSPO','class_1_2','Transport & Communication',7),
  ('EPO','class_3_5','Reading Comprehension',1),
  ('EPO','class_3_5','Grammar & Syntax',2),
  ('EPO','class_3_5','Vocabulary',3),
  ('EPO','class_3_5','Spelling & Punctuation',4),
  ('EPO','class_3_5','Sentence Formation',5),
  ('EPO','class_3_5','Creative Expression',6),
  ('EPO','class_3_5','Verbal Reasoning',7),
  ('EPO','class_3_5','Literature',8),
  ('MPO','class_3_5','Number Systems',1),
  ('MPO','class_3_5','Arithmetic Operations',2),
  ('MPO','class_3_5','Fractions & Decimals',3),
  ('MPO','class_3_5','Geometry & Shapes',4),
  ('MPO','class_3_5','Measurement & Units',5),
  ('MPO','class_3_5','Data Handling',6),
  ('MPO','class_3_5','Patterns & Sequences',7),
  ('MPO','class_3_5','Word Problems',8),
  ('MPO','class_3_5','Calculations',9),
  ('SPO','class_3_5','Living Things',1),
  ('SPO','class_3_5','Materials & Matter',2),
  ('SPO','class_3_5','Forces & Energy',3),
  ('SPO','class_3_5','Earth & Environment',4),
  ('SPO','class_3_5','Human Body',5),
  ('SPO','class_3_5','Scientific Investigation',6),
  ('SPO','class_3_5','Plants & Animals',7),
  ('SPO','class_3_5','Light & Sound',8),
  ('GKSSPO','class_3_5','Current Affairs',1),
  ('GKSSPO','class_3_5','Geography',2),
  ('GKSSPO','class_3_5','History & Civics',3),
  ('GKSSPO','class_3_5','Sports & Entertainment',4),
  ('GKSSPO','class_3_5','Science & Technology',5),
  ('GKSSPO','class_3_5','Arts & Culture',6),
  ('GKSSPO','class_3_5','Famous Personalities',7),
  ('GKSSPO','class_3_5','Environment',8),
  ('EPO','class_6_8','Reading Comprehension',1),
  ('EPO','class_6_8','Grammar & Usage',2),
  ('EPO','class_6_8','Vocabulary & Word Power',3),
  ('EPO','class_6_8','Writing Skills',4),
  ('EPO','class_6_8','Literature & Poetry',5),
  ('EPO','class_6_8','Verbal Reasoning',6),
  ('EPO','class_6_8','Idioms & Phrases',7),
  ('EPO','class_6_8','Sentence Correction',8),
  ('EPO','class_6_8','Punctuation & Spelling',9),
  ('MPO','class_6_8','Number Systems',1),
  ('MPO','class_6_8','Algebra',2),
  ('MPO','class_6_8','Geometry',3),
  ('MPO','class_6_8','Mensuration',4),
  ('MPO','class_6_8','Data Handling & Statistics',5),
  ('MPO','class_6_8','Ratio & Proportion',6),
  ('MPO','class_6_8','Fractions & Decimals',7),
  ('MPO','class_6_8','Calculations',8),
  ('MPO','class_6_8','Word Problems',9),
  ('SPO','class_6_8','Physics Concepts',1),
  ('SPO','class_6_8','Chemistry Basics',2),
  ('SPO','class_6_8','Biology & Life Sciences',3),
  ('SPO','class_6_8','Environmental Science',4),
  ('SPO','class_6_8','Scientific Method',5),
  ('SPO','class_6_8','Health & Nutrition',6),
  ('SPO','class_6_8','Earth & Space',7),
  ('SPO','class_6_8','Materials & Properties',8),
  ('GKSSPO','class_6_8','Current Affairs',1),
  ('GKSSPO','class_6_8','Geography & Maps',2),
  ('GKSSPO','class_6_8','History & Ancient Civilizations',3),
  ('GKSSPO','class_6_8','Indian Constitution & Civics',4),
  ('GKSSPO','class_6_8','Science & Inventions',5),
  ('GKSSPO','class_6_8','Sports & Awards',6),
  ('GKSSPO','class_6_8','Arts & Literature',7),
  ('GKSSPO','class_6_8','Famous Personalities',8),
  ('KidsPO','lkg_ukg','Shapes & Colors',1),
  ('KidsPO','lkg_ukg','Numbers & Counting',2),
  ('KidsPO','lkg_ukg','Animals & Plants',3),
  ('KidsPO','lkg_ukg','My Body',4),
  ('KidsPO','lkg_ukg','Good Habits',5),
  ('KidsPO','lkg_ukg','Family & Community',6),
  ('KidsPO','lkg_ukg','Rhymes & Stories',7),
  ('LRPO','class_1_2','Patterns & Sequences',1),
  ('LRPO','class_1_2','Odd One Out',2),
  ('LRPO','class_1_2','Picture Analogies',3),
  ('LRPO','class_1_2','Spatial Sense & Directions',4),
  ('LRPO','class_1_2','Counting Figures',5),
  ('LRPO','class_1_2','Classification & Grouping',6),
  ('LRPO','class_1_2','Mirror Images',7),
  ('LRPO','class_1_2','Simple Puzzles',8),
  ('LRPO','class_3_5','Number & Letter Series',1),
  ('LRPO','class_3_5','Analogies',2),
  ('LRPO','class_3_5','Classification',3),
  ('LRPO','class_3_5','Coding–Decoding',4),
  ('LRPO','class_3_5','Directions & Distance',5),
  ('LRPO','class_3_5','Ranking & Ordering',6),
  ('LRPO','class_3_5','Mirror & Water Images',7),
  ('LRPO','class_3_5','Figure Counting & Embedded Figures',8),
  ('LRPO','class_3_5','Calendar & Time Puzzles',9),
  ('LRPO','class_6_8','Series Completion',1),
  ('LRPO','class_6_8','Analogies',2),
  ('LRPO','class_6_8','Classification',3),
  ('LRPO','class_6_8','Coding–Decoding',4),
  ('LRPO','class_6_8','Blood Relations',5),
  ('LRPO','class_6_8','Direction Sense',6),
  ('LRPO','class_6_8','Ranking & Arrangement',7),
  ('LRPO','class_6_8','Venn Diagrams & Syllogisms',8),
  ('LRPO','class_6_8','Non-Verbal Reasoning (figure series, paper folding & cutting, mirror/water images)',9),
  ('LRPO','class_6_8','Calendar & Clock',10),
  ('LRPO','class_6_8','Logical Puzzles',11)
;

COMMIT;
