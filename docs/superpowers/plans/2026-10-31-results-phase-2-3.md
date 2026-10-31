# Results Phases 2–3 (Evaluation, Scores, Ranks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff upload answer CSVs against a Ready paper, mark absentees, and see scores, grades, 4-level ranks and per-school results, all inside the CRM.

**Architecture:** One additive migration adds evaluations (one row per enrolment, answers/marks as arrays: the free-plan DB can't afford one row per question), computed scores and ranks, upload batches and resend flags. All writes go through SECURITY DEFINER RPCs that check `is_manager_or_superadmin()`, validate all-or-nothing and re-score/re-rank in the same transaction. The UI is React pages under `/results/*` calling those RPCs.

**Tech Stack:** Postgres (plpgsql), React + TS + shadcn/ui + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-results-module-design.md` (sections 3–5, 7 phases 2–3, Appendix B pages 3–6, 8).

## Global Constraints

- Everything in `2026-10-31-results-phase-0-1.md` → Global Constraints still applies (live DB, apply only after Goghul's yes, plain English, ≥14px body text, determinate % progress bars, soft deletes, audit log, `security_invoker` views, olympiad mapping, never the `subjects` table).
- Registration numbers are matched **digits only** on both sides (`regexp_replace(x,'\D','','g')`). Format: `{olympiad 1}{state 2}{district 2}{school 2}{class 2}{roll 3}` = 12 digits. Olympiad digit: 1 EPO, 2 MPO, 3 SPO, 4 GKSSPO, 5 LRPO, 9 KidsPO.
- District and state for ranks/averages come from the **registration number** (state = digits 2–3, district key = digits 2–5). Not from `schools.state`.
- Scoring: no negative marking. OMR: 1 per answer equal to the key; a grace question gives 1 to everyone evaluated. Manual: sum of marks (0/0.5/1); grace gives 1. `percentage = round(total*100/max_marks)` where `max_marks = total_questions`.
- Ranks: `RANK()` with ties, per project × class × olympiad, **both slots combined**, at school / district / state / national level, over evaluated (not absent) students only.
- Student grade: ≥95 `A++` Olympiad Excellence · ≥90 `A+` National Level Potential · ≥80 `A` High Performer · ≥70 `B+` Strong Foundation · ≥60 `B` Satisfactory · ≥50 `C` Average · <50 `D` Needs Academic Support. School grade (on the school's average %): ≥80 `A` Excellent · ≥60 `B` Good · ≥40 `C` Average · <40 `D` Needs Improvement.
- Uploads are **all or nothing**. Error text examples (verbatim style): `Row 14: 3290201010099 is not a registered student in this project` · `Row 14: 2330301060102 is registered for Maths, but this paper is English` · `Row 14: 2330301060102 is a Class 2 student, but this paper is Class 3` · `Row 14 has 48 answers; this paper has 50 questions` · `Row 14, Q7: "E" is not A, B, C or D` · `Row 14, Q7: "2" must be 0, 0.5 or 1` · `Row 14: 2330301060102 appears twice in this file (rows 9 and 14)` · `Row 14 has no registration number`.
- Only **Ready** papers accept uploads: `This paper isn't marked Ready yet. Finish its answer key on the Question Papers page first.`
- A paper's tab: classes 14, 15, 01, 02 → **Manual** (0/0.5/1); 03–08 → **OMR** (A–D, blank = unanswered).
- Results are for everyone enrolled; payment status is ignored (spec: unpaid schools treated the same).

## Review Focus

1. **Re-uploading a file for students who already have results.** The check shows "N students already have results and will be replaced" with a downloadable list; nothing changes until Confirm; the old rows are soft-deleted, not destroyed. Test in Task 1 (SQL) and Task 3.
2. **An answer-key change after results exist.** Scores and ranks recompute automatically in the same transaction; a released school whose students' score/grade/rank changed gets a resend flag. Test in Task 1.
3. **A CSV from the OMR operator with hyphens, spaces, lowercase answers, a BOM, or `Q01` headers.** Parsed correctly; registration numbers compared digits-only; answers upper-cased. Test in Task 2.
4. **A student marked absent who then appears in an uploaded file.** The upload replaces the absent mark (listed in the replace warning). Test in Task 1.
5. **A school booked on Slot 1 appearing in a Slot 2 paper's file.** Warn, don't block: `12 students are from schools booked on Slot 1`. Test in Task 1.

---

### Task 1: Evaluation migration + SQL test

**Files:** Create `supabase/migrations/20261102_results_evaluation.sql`, `supabase/tests/results_evaluation.sql`.

**Interfaces — Produces (exact names):**
- Tables:
  - `result_upload_batches(id uuid pk, paper_id uuid → question_papers, kind text check in ('omr','manual'), file_name text, row_count int, replaced_count int, uploaded_by uuid default auth.uid(), created_at timestamptz)`.
  - `result_evaluations(id uuid pk, enrollment_id uuid not null → portal_student_enrollments, paper_id uuid not null → question_papers, status text check in ('evaluated','absent'), answers text[] (each 'A'..'D' or NULL), marks numeric(2,1)[] (each 0/0.5/1 or NULL), batch_id uuid → result_upload_batches null, created_by/created_at/updated_by/updated_at, deleted_at)`. Check: absent ⇒ answers and marks NULL; evaluated ⇒ exactly one of answers/marks non-null. Partial unique index on `(enrollment_id) WHERE deleted_at IS NULL`. Index `(paper_id) WHERE deleted_at IS NULL`. Touch + audit triggers (reuse `result_touch_updated`, `result_audit`).
  - `result_scores(enrollment_id uuid pk → portal_student_enrollments, evaluation_id uuid, paper_id uuid, project_id uuid, school_id uuid, class_code text, olympiad_code text, state_code text, district_key text, total numeric(5,1), max_marks int, percentage int, grade text, rank_school int, rank_district int, rank_state int, rank_national int, computed_at timestamptz)`. Index `(project_id, class_code, olympiad_code)`, `(school_id)`.
  - `result_resend_flags(id uuid pk, project_id, school_id, reason text, created_at, cleared_at, cleared_by)`.
- Functions (all `SET search_path = public`; write RPCs are SECURITY DEFINER and start with `IF NOT public.is_manager_or_superadmin() THEN RAISE EXCEPTION 'Only managers can do this.'`):
  - `results_digits(text) returns text` IMMUTABLE.
  - `results_student_grade(int) returns text`, `results_school_grade(numeric) returns text`.
  - `results_upload(p_paper_id uuid, p_kind text, p_file_name text, p_rows jsonb, p_dry_run boolean) returns jsonb`. `p_rows` = `[{"row":2,"reg":"2-33-03-06-01-020","values":["A",null,"C",…]}]` (values are text for OMR, numbers for manual). Returns `{"ok":false,"errors":[{"row":14,"message":"…"}]}` (cap 500 errors; `"moreErrors":n`), or `{"ok":true,"dryRun":true,"count":n,"replace":[{"reg":…,"name":…,"was":"evaluated"|"absent"}],"otherSlot":{"count":n,"slotName":"Slot 1"},"missingFromFile":n}`, or after a real run `{"ok":true,"saved":n,"replaced":n,"batchId":…}`. The real run re-validates, soft-deletes replaced live evaluations, inserts, then calls `results_rescore_paper`.
  - `results_set_absent(p_paper_id uuid, p_enrollment_ids uuid[], p_absent boolean) returns int`: absent → soft-delete the live evaluation and insert an `absent` one; present → soft-delete the live `absent` row (student becomes Pending). Re-scores.
  - `results_delete_evaluations(p_enrollment_ids uuid[]) returns int` (soft) and `results_restore_evaluation(p_evaluation_id uuid) returns void` (refuses if older than 30 days, or if the enrolment already has a live evaluation: `This student already has a newer result.`).
  - `results_correct_answer(p_evaluation_id uuid, p_question_number int, p_value text) returns void`: sets one element (OMR: 'A'..'D' or '' → NULL; manual: '0','0.5','1'); audit captures before/after; re-scores.
  - `results_rescore_paper(p_paper_id uuid) returns void`: rebuilds `result_scores` rows for every enrolment whose live evaluation is on that paper (deletes rows for absent/deleted), then `results_rerank` for that project/class/olympiad, then writes `result_resend_flags` (reason `Scores changed after release`) for schools in `school_result_release` whose students' total/grade/any rank changed (compare a before-snapshot). Skip the flag if an uncleared one exists.
  - `results_rerank(p_project_id uuid, p_class_code text, p_olympiad_code text) returns void`.
  - Statement-level `AFTER UPDATE ON questions REFERENCING NEW TABLE/OLD TABLE` trigger: for each distinct paper where `correct_answer` or `is_grace` changed, call `results_rescore_paper`.
  - Read RPCs (SECURITY INVOKER, STABLE): `results_student_list(p_project_id uuid, p_school_id uuid, p_class_code text, p_olympiad_code text, p_status text /* 'evaluated'|'absent'|'pending'|'deleted'|null */, p_search text, p_limit int, p_offset int)` returning enrolment id, reg, student name, school name, class, olympiad, status, total, percentage, grade, evaluation id, deleted_at, plus `total_count` on every row; `results_school_summary(p_project_id uuid)` one row per school with enrolled, evaluated, absent, pending, avg_percentage, school grade, state_code, state_avg_percentage, released (bool), resend_flag (bool); `results_class_olympiad_summary(p_project_id uuid, p_school_id uuid)` per class×olympiad: enrolled, evaluated, absent, avg %, state avg % for that class×olympiad; `results_rank_list(p_project_id, p_class_code, p_olympiad_code, p_limit, p_offset)` ordered by `rank_national`, with school name, state and district names (`district_codes`), `total_count`.
- RLS on all 4 tables: SELECT for `is_manager_or_superadmin()`; no INSERT/UPDATE/DELETE policies (writes only via the RPCs). REVOKE ALL from anon; REVOKE INSERT/UPDATE/DELETE/TRUNCATE from authenticated. GRANT EXECUTE on the RPCs to authenticated only.

- [ ] **Step 1:** Write `supabase/tests/results_evaluation.sql` as one `BEGIN … ROLLBACK` block that impersonates a manager (`set local role authenticated; set local request.jwt.claims` to a real manager's `user_id` from `profiles`) and asserts with `RAISE EXCEPTION` on failure, ending with `SELECT 'ALL PASS'`. Fixture: a temp Ready paper (class 03, MPO, 5 questions, key A,B,C,D,A) for a real project, using 3 real MPO class-03 enrolments. Cases:
  - (a) dry run with an unknown reg → errors[0].message = `Row 2: 9999999999999 is not a registered student in this project`; nothing inserted.
  - (b) one bad row among good rows → `ok:false`, 0 evaluations exist (all-or-nothing).
  - (c) valid upload ["A","B","C","D","A"] → total 5, percentage 100, grade `A++`; ["A",null,"X"…] rejected with `Row 2, Q3: "X" is not A, B, C or D`.
  - (d) hyphenated and digits-only regs both match.
  - (e) re-upload dry run lists the student under `replace`; real run soft-deletes the old row (`deleted_at` set) and inserts a new one.
  - (f) two students with equal totals get the same `rank_school`, the next gets rank 3.
  - (g) updating Q1's key from A to B re-scores in the same statement (total drops by 1 for a student who answered A).
  - (h) grace on Q2 gives every evaluated student the mark.
  - (i) `results_set_absent` → no `result_scores` row; ranks of the others recompute.
  - (j) a manual paper (class 01) with marks [1,0.5,0,1,…] totals correctly; `"2"` rejected with the manual message.
  - (k) anon has no SELECT on `result_scores`; `authenticated` cannot INSERT into `result_evaluations` directly.
  - (l) an upload to a draft paper fails with the "isn't marked Ready" message.
  - (m) a released school (insert into `school_result_release` in the test) gets a `result_resend_flags` row after a key change alters a score.
- [ ] **Step 2:** Write the migration (BEGIN/COMMIT, additive only: no DROP, no ALTER of existing tables).
- [ ] **Step 3:** Commit `feat(results): evaluation schema (not applied)`. **Controller only:** show Goghul, apply on his yes, run the test (expect `ALL PASS`), regenerate `src/integrations/supabase/types.ts`, build.

### Task 2: Pure libs — grades, registration numbers, CSV parsing, templates

**Files:** Create `src/lib/results/grading.ts`, `src/lib/results/regNumber.ts`, `src/lib/results/evaluationCsv.ts`, tests in `src/lib/results/__tests__/`.

**Interfaces — Produces:**
- `studentGrade(pct: number): { grade: string; label: string }`, `schoolGrade(pct: number): { grade: string; label: string }` (values from Global Constraints).
- `regDigits(s: string): string`; `parseReg(s: string): { olympiad: OlympiadCode; state: string; district: string; school: string; classCode: string; roll: string } | null` (null unless exactly 12 digits with a known olympiad digit); `formatReg(digits: string): string` → `2-33-03-06-01-020`.
- `answerMode(classCode: string): 'manual' | 'omr'`.
- `parseEvaluationCsv(text: string, mode: 'manual'|'omr', totalQuestions: number): { rows: { row: number; reg: string; values: (string|number|null)[] }[]; errors: { row: number; message: string }[] }`. Accepts a BOM, `\r\n`, quoted fields; header row required with a column named `registration_number` / `reg_no` / `registration number` / `roll no` (case/space-insensitive) and question columns `Q1`/`Q01`/`1` …; extra columns (e.g. `student_name`) ignored. OMR values trimmed and upper-cased; blank → null. Manual values `0`, `0.5`, `.5`, `1`; blank → null. Missing question columns → one file-level error `The file has 48 question columns; this paper has 50 questions` (row 1). Header problems are row 1 errors. The server re-validates; this gives instant feedback.
- `buildTemplateCsv(totalQuestions: number, students: { reg: string; name: string }[]): string` → header `registration_number,student_name,Q1..Qn` and one row per student with blank answers.

- [ ] **Step 1:** Tests: every grade boundary (95→A++, 94→A+, 50→C, 49→D; school 80/79/40/39); `parseReg('2-33-03-06-01-020').classCode === '01'`; `parseReg('12345')` null; OMR row `" a ,b,,D"` → `['A','B',null,'D']`; BOM + CRLF file; `Q01` headers; manual `.5` → 0.5; 48 vs 50 columns message; a template round-trips through the parser. Run → FAIL.
- [ ] **Step 2:** Implement without new dependencies (a small RFC-4180 parser). Run → PASS. Commit `feat(results): grading, registration number and CSV libs`.

### Task 3: Upload Answers page

**Files:** Create `src/pages/results/UploadAnswersPage.tsx`, `src/components/results/upload/*` (`PaperPicker.tsx`, `UploadChecker.tsx`, `ErrorList.tsx`, `ReplaceWarning.tsx`), `src/hooks/results/useEvaluations.ts`. Wire route `/results/upload`; bump `CURRENT_RESULTS_PHASE` to 3 in `nav.ts` and add the routes in `ResultsLayout`.

**Interfaces:** Consumes Task 1 RPCs and Task 2 libs, `ProgressPanel`, `usePapers` from Phase 1.

Page behaviour:
- Two tabs: **Manual marks (LKG – Class 2)** and **OMR answers (Class 3 – 8)**. Each lists only Ready papers of its classes in a picker ("Class 1 · Maths · Slot 2"); non-ready papers show greyed with "Not ready yet".
- **Download template** for the picked paper (pre-filled with every enrolled student's registration number and name for that class × olympiad, from `results_student_list`).
- Drop/choose a `.csv` → ProgressPanel stages: `Reading file` (real % from FileReader progress) → `Checking 812 students` (dry run; 40%→90% when it returns) → result.
- Errors: a red panel "We couldn't accept this file. Nothing was saved." + a table of row errors (first 100, "and 37 more") + **Download error list** CSV.
- Clean: summary card "812 students ready to save", with the replace warning (count + **Download list**), the other-slot warning, and "45 registered students are not in this file (they will stay Pending)". **Confirm and save** → real run with ProgressPanel `Saving and calculating ranks`. Success toast "812 results saved. Ranks updated."
- [ ] **Step 1:** Load `frontend-design` and `ui-ux-pro-max`. Testing Library test `UploadAnswersPage.test.tsx` (mock the hooks): (a) an error result renders "Nothing was saved" and the row message; (b) a dry run with `replace` of 3 shows "3 students already have results and will be replaced" and Confirm stays disabled until the checkbox "I understand" is ticked; (c) the Manual tab lists only classes 14/15/01/02 papers. Run → FAIL.
- [ ] **Step 2:** Implement. Tests PASS, `npm run build` OK. Commit `feat(results): upload answers page`.

### Task 4: Students & Attendance + Student Result pages

**Files:** Create `src/pages/results/StudentsPage.tsx`, `src/pages/results/StudentResultPage.tsx`, `src/components/results/students/*`. Routes `/results/students`, `/results/students/:enrollmentId`.

- **Students & Attendance:** filters (school search, class, olympiad, status: All / Evaluated / Absent / Pending / Deleted); server-paginated table (50/page) with checkboxes; columns Reg no, Name, School, Class, Olympiad, Status badge, Score (total/max), %, Grade. Bulk bar: **Mark absent**, **Mark present**, **Delete result** (each with a confirm dialog naming the count; absent/present need a paper, taken from the student's class × olympiad × school's booked slot. If the class × olympiad has papers for both slots, ask which). Deleted filter shows **Restore** (within 30 days).
- **Student Result:** header (name, reg no, school, class, olympiad), tiles: Score, %, Grade + label, School rank, District rank, State rank, All-India rank (each "x of N"); answer review table: Q#, student answer/mark, correct answer (or "Grace"), ✓/✗/½, skill; **Correct this answer** opens a dialog (new value + required reason), saved via `results_correct_answer`; **Change history** list from `result_audit_log` for this evaluation (who, when, before → after). Absent and pending states show a plain message.
- [ ] **Step 1:** Tests: (a) selecting 2 rows and Mark absent opens "Mark 2 students absent?"; (b) the Student Result page for an absent student shows "This student was marked absent"; (c) the correction dialog blocks Save until a reason is typed. Run → FAIL.
- [ ] **Step 2:** Implement. PASS, build OK. Commit `feat(results): students, attendance and student result pages`.

### Task 5: Rankings page

**Files:** Create `src/pages/results/RankingsPage.tsx`, `src/components/results/rankings/*`. Route `/results/rankings`.

- Pick class and olympiad (only combinations with scores). Table from `results_rank_list`: All-India rank, State rank, District rank, School rank, Name, Reg no, School, District, State, Score, %, Grade; filter by state/district/school (client-side on the loaded page is not enough: pass filters to the RPC — add optional `p_state_code`, `p_district_key`, `p_school_id` params in Task 1 if missing, else filter server-side via a second RPC call).
- **Download rank list (CSV)** for the selection, with ProgressPanel while paging through all rows (500 per call).
- Second tab **Registered vs Evaluated**: per school × class × olympiad: Registered, Evaluated, Absent, Pending; CSV download.
- [ ] **Step 1:** Test: the CSV builder `rankListCsv(rows)` outputs the header and quotes school names with commas. Run → FAIL. Implement → PASS. Commit `feat(results): rankings page`.

### Task 6: School Results, detail page, dashboard, CRM school tab

**Files:** Create `src/pages/results/SchoolResultsPage.tsx`, `src/pages/results/SchoolResultDetailPage.tsx`; modify `src/pages/results/ResultsDashboard.tsx` and `SchoolResultsSummary` (the CRM school page Results tab component). Routes `/results/schools`, `/results/schools/:schoolId`.

- **School Results:** table from `results_school_summary`: School, State, Enrolled, Evaluated, Absent, Pending, Average %, Grade, vs state average (e.g. "+6% above state" green / "−4% below state" amber), Released (Yes/No), "Resend needed" badge. Search + sort.
- **Detail:** tiles (Enrolled, Evaluated, Absent, Pending, School average, Grade vs state average); class × olympiad table from `results_class_olympiad_summary`; student list (reuses the Students table filtered to the school); action buttons for Phase 4/5 (AI analysis, school PDFs, zips) rendered disabled with the tooltip "Available after skill reports are built". Phase 4/5 enables them.
- **Dashboard:** live tiles: Papers ready (x of N), Students evaluated per slot, Registered vs evaluated, Absent, Schools awaiting release, Resend flags.
- **CRM school tab:** a summary (evaluated/enrolled, average %, grade) and a link "Open full results" → `/results/schools/:schoolId`.
- [ ] **Step 1:** Test `vsStateText(+6.2)` → "6% above state average", `vsStateText(-4)` → "4% below state average", `0` → "Same as state average". Run → FAIL. Implement → PASS, build OK. Commit `feat(results): school results, dashboard and school tab`.

### Task 7: Close-out

- [ ] Whole-branch review (most capable model) of Tasks 1–6; one fix round; `npx vitest run` and `npm run build` green; ledger updated. No deploy or push without Goghul's yes.
