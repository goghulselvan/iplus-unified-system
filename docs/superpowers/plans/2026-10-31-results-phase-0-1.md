# Results Module — Phase 0 (Foundation) + Phase 1 (Question Papers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old relay-based Results screens with a CRM-native Results module. By the end, managers can create a question paper per class × olympiad × slot, upload its PDF, have the AI propose answers, skills and cognitive levels, correct them, and mark the paper ready.

**Architecture:** Results tables live in the CRM Supabase DB and key on `portal_student_enrollments`. The 11 leftover empty tables are dropped and recreated correctly. Files go to Cloudflare R2 through presigned URLs issued by an edge function, so the browser uploads directly and shows real % progress. Paper analysis is an edge function that calls Claude Sonnet 5.5 in chunks of 20 questions; the client drives the chunks, so the progress bar is genuine and each call stays well inside edge-function time limits.

**Tech Stack:** React 18 + Vite + TS, shadcn/ui, TanStack Query, Supabase (Postgres + RLS + Deno edge functions), Cloudflare R2 (S3 API, `aws4fetch`), Anthropic Messages API (`claude-sonnet-5-5`, PDF document blocks, structured output), Vitest (new) for pure logic.

**Spec:** `docs/superpowers/specs/2026-10-31-results-module-design.md` (sections 3–6, Appendix A, Appendix B).

## Global Constraints

- DB: CRM project `eucjeggfclztkbbupaav`, **free plan, 234 MB of 500 MB**. **Every migration is shown to Goghul and applied only after his "yes".** Apply with `supabase db query --linked -f <file>`.
- **Never modify** the old results project `wrmbhorgiagppapoajub`.
- Results access: `public.is_manager_or_superadmin()` only. Superadmin-only actions (release, send) arrive in Phase 5. Phase 0/1 has none.
- Olympiad codes are exactly `EPO, MPO, SPO, GKSSPO, LRPO, KidsPO`. **Never** use the `subjects` table.
- Olympiads per class: `14`/`15` (LKG/UKG) → `KidsPO` only; `01`–`08` → `EPO, MPO, SPO, GKSSPO, LRPO`.
- Question counts come from `classes.question_count` (LKG/UKG 30, 1–2 40, 3–5 50, 6–8 60).
- Answers: `A|B|C|D`, or null when the question is a grace question. Cognitive levels: `Remember, Understand, Apply, Analyze, Evaluate, Create`.
- **Every upload / export / long process shows a determinate % progress bar** (shadcn `Progress`) with a plain-English stage label. Spinners alone are not acceptable.
- **UI copy is plain English for office staff.** Body text ≥ 14px, labels ≥ 13px, WCAG AA contrast, no database words in any message. UI tasks load the `frontend-design` and `ui-ux-pro-max` skills first.
- **Deletes are soft** (`deleted_at`). Every change to papers and questions is written to `result_audit_log`.
- New/replaced views need `security_invoker = on`. Storage stays in R2 (secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`); the AI key is secret `ANTHROPIC_API_KEY`.
- Every browser-facing edge function: OPTIONS handler + CORS headers; JWT verified; role checked by calling `is_manager_or_superadmin()` with the caller's JWT; a top-level try/catch that returns a plain-English `{ error }`.
- R2 object keys: `{project_id}/papers/{paper_id}.pdf`.

## Review Focus

1. **A PDF whose AI output has the wrong number of questions** (e.g. 48 instead of 50, or duplicates). The chunk is rejected with "The AI found 48 questions but this paper should have 50 — please re-run or enter them by hand"; nothing partial is saved. Test in Task 6.
2. **A manager re-running analysis on a paper staff already corrected.** Hand-corrected answers must not be silently overwritten: the re-run asks for confirmation, and every overwritten value is in the audit log. Test in Task 6 (parser keeps flags) and Task 8 (confirm dialog).
3. **A large PDF (25–40 MB) on a slow school-office connection.** The upload shows real % and can be cancelled; a failed upload leaves the paper without a PDF rather than a broken key. Test in Task 7.
4. **Copy from Slot 1 when Slot 2 already has questions.** It must ask before replacing, and copy answers, skills, grace flags and the PDF key. Test in Task 5.
5. **Marking a paper "Ready" with a missing answer or skill.** Blocked, with the exact question numbers listed. Test in Task 5.

---

## Phase 0 — Foundation

### Task 0: Baseline commit of the live working tree *(needs Goghul's OK — do not run without it)*

`main` has ~30 uncommitted files that are **already live**, including the 10-22 WhatsApp-inbound work. Results tasks edit `App.tsx`, `Navbar.tsx` and `SchoolDetail.tsx`, which are among them. Without a baseline, Results commits would mix in that work. A worktree from HEAD can't be used either: it would lack live code, and a zip built from it would roll production back.

- [ ] **Step 1:** Ask Goghul: "May I commit the current uncommitted files as one 'baseline: live state 2026-10-31' commit (excluding the `crm-*.zip` files)?"
- [ ] **Step 2:** On yes, run `git add -A -- . ':!*.zip' ':!supabase/.temp' && git commit -m "baseline: live state 2026-10-31"`. Expected: a clean `git status` apart from the zips.

### Task 1: Test harness

**Files:** Modify `package.json`; Create `vitest.config.ts`, `src/lib/results/__tests__/smoke.test.ts`

- [ ] **Step 1:** `npm i -D vitest@2` and add the script `"test": "vitest run"`. The config reuses the `@` alias from `vite.config.ts` and runs in a `node` environment.
- [ ] **Step 2:** Add a smoke test `expect(1+1).toBe(2)`. Run `npm test`; expected: 1 passed.
- [ ] **Step 3:** Commit `chore: add vitest`.

### Task 2: Phase 0 migration (schema)

**Files:** Create `supabase/migrations/20261101_results_foundation.sql`, `supabase/tests/results_foundation.sql`

**Interfaces — Produces** (later tasks rely on these exact names):
- `question_papers(id uuid pk, project_id uuid → olympiad_projects, class_code text → classes(code), olympiad_code text CHECK in the 6 codes, slot_template_id uuid → exam_slot_templates, total_questions int, pdf_r2_key text null, pdf_file_name text null, status text CHECK in ('draft','ready') default 'draft', analysis_status text CHECK in ('none','running','done','failed') default 'none', analysis_progress int 0–100 default 0, analysis_error text null, created_by uuid, created_at, updated_by uuid, updated_at, deleted_at timestamptz null)`
- Partial unique index on `(project_id, class_code, olympiad_code, slot_template_id) WHERE deleted_at IS NULL`.
- CHECK `(class_code IN ('14','15')) = (olympiad_code = 'KidsPO')`.
- `questions(id, paper_id → question_papers ON DELETE CASCADE, question_number int CHECK ≥1, question_text text, has_figure bool default false, correct_answer text CHECK in ('A','B','C','D') null, is_grace bool default false, skill_category text null, skill_description text null, nep_skill_mapping text null, cognitive_level text CHECK in the 6 levels null, ai_confidence numeric(3,2) null, human_edited bool default false, updated_by uuid, updated_at)`, `UNIQUE(paper_id, question_number)`, CHECK `is_grace OR correct_answer IS NOT NULL OR human_edited = false`.
- `result_skill_lists(olympiad_code text, class_group text CHECK in ('lkg_ukg','class_1_2','class_3_5','class_6_8'), skill text, sort_order int, PK(olympiad_code, class_group, skill))`
- `result_audit_log(id bigserial, table_name text, row_id uuid, action text, before jsonb, after jsonb, changed_by uuid default auth.uid(), changed_at timestamptz default now())`, plus trigger fn `result_audit()` attached AFTER INSERT/UPDATE/DELETE on `question_papers` and `questions`.
- `updated_at` / `updated_by = auth.uid()` BEFORE UPDATE triggers on both tables.
- RLS on all four tables. papers/questions: SELECT/INSERT/UPDATE/DELETE `USING/WITH CHECK (public.is_manager_or_superadmin())`. Skill lists: SELECT for `is_manager_or_superadmin()`. Audit log: SELECT only for the same role (inserts come from the SECURITY DEFINER trigger).

- [ ] **Step 1: Write the failing SQL test.** `supabase/tests/results_foundation.sql` runs inside `BEGIN … ROLLBACK`, raises an exception on any failed assertion, and ends `SELECT 'ALL PASS'`. Assertions:
  - the 4 tables exist with RLS enabled;
  - inserting `('14','MPO')` fails the KidsPO CHECK, and `('03','KidsPO')` fails too;
  - a duplicate live `(project, class, olympiad, slot)` fails, but succeeds once the first row has `deleted_at` set;
  - `correct_answer = 'E'` fails;
  - an UPDATE on `questions` writes one `result_audit_log` row with before/after;
  - `result_skill_lists` has ≥ 8 rows for `('LRPO','class_1_2')` and 0 rows for any `class_9_12`;
  - `result_students`, `olympiad_results`, `student_reports`, `student_responses`, `student_skill_analysis`, `analysis_jobs`, `school_analysis`, `awards`, `school_flags` no longer exist.
- [ ] **Step 2:** Run `supabase db query --linked -f supabase/tests/results_foundation.sql`. Expected: FAIL (the tables don't have the new columns yet).
- [ ] **Step 3: Write the migration.** In order:
  - (a) a `DO` block that **raises an exception if any of the 11 leftover tables has rows**, a safety stop;
  - (b) `DROP TABLE` the 11 leftovers (`question_papers, questions, student_responses, student_skill_analysis, student_reports, analysis_jobs, result_students, olympiad_results, school_analysis, awards, school_flags`), leaving `school_result_release` untouched;
  - (c) create the objects above;
  - (d) seed `result_skill_lists`. The old app's `SKILLS_BY_CLASS_SUBJECT` (`iplusresults-main/supabase/functions/analyze-skills/index.ts:10-46`) maps 1→EPO, 2→MPO, 3→SPO, 4→GKSSPO for groups `class_1_2, class_3_5, class_6_8`. Its `lkg_ukg[5]` list goes to `KidsPO/lkg_ukg`. LRPO gets the spec's Appendix A lists. Drop `class_9_12` and the old `lkg_ukg` 1–4 lists.
- [ ] **Step 3b: STOP — show Goghul the migration** with a 5-line plain summary ("drops 11 empty leftover tables, creates 4, seeds the skill lists, nothing existing changes"). Apply only after his yes: `supabase db query --linked -f supabase/migrations/20261101_results_foundation.sql`.
- [ ] **Step 4:** Re-run the SQL test. Expected: `ALL PASS`. Check `pg_database_size` is still ≈234 MB.
- [ ] **Step 5:** Regenerate the types (`supabase gen types typescript --linked > src/integrations/supabase/types.ts`), run `npm run build` (expected: success), then commit `feat(results): foundation schema`.

### Task 3: Remove the old relay; add the module shell and navigation

**Files:**
- Delete: `src/lib/olympiadProxy.ts`, `src/hooks/useOlympiadResults.ts`, `src/components/results/StudentResultModal.tsx`
- Replace: `src/components/results/SchoolResultsSummary.tsx`, `src/pages/Results.tsx`
- Modify: `src/App.tsx` (the `/results` route becomes `/results/*`)
- Create: `src/pages/results/ResultsLayout.tsx`, `src/pages/results/ResultsDashboard.tsx` (placeholder tiles), `src/lib/results/nav.ts`

**Interfaces — Produces:**
- `RESULTS_NAV: { key: string; label: string; path: string; phase: number }[]`, all 11 pages from Appendix B. Pages whose phase > the current build phase render "Coming in the next update", never a blank screen.
- Route `/results/papers` (Task 8).
- `<SchoolResultsSummary schoolId={string} />` shows "Results for 2026 will appear here after evaluation" plus an "Open full results" link to `/results/schools/:schoolId`.

- [ ] **Step 1:** Write a test `nav.test.ts`: `RESULTS_NAV` has 11 entries, unique paths all under `/results`, and labels exactly as Appendix B. Run it; expected: FAIL.
- [ ] **Step 2:** Implement `nav.ts`, the layout (left sub-nav on desktop, a tab strip on mobile), the dashboard shell, the summary replacement, and the route. Update the `SchoolDetail.tsx` Results tab to pass `school.id` instead of `ss_no`.
- [ ] **Step 3:** `npm test && npm run build`. Expected: PASS; `grep -rn "olympiadProxy\|olympiad-proxy" src` returns nothing.
- [ ] **Step 4:** Commit `feat(results): module shell, remove old relay`. The deployed `olympiad-proxy` edge function is **left in place**; deleting it needs Goghul's explicit OK at the end of Phase 1.

### Task 4: R2 presign edge function

**Files:** Create `supabase/functions/results-files/index.ts`, `supabase/functions/results-files/keys.ts`, `supabase/functions/results-files/keys.test.ts` (Deno)

**Interfaces — Produces:**
- `POST /functions/v1/results-files` with body `{ action: 'upload' | 'download' | 'delete', key: string, contentType?: string }`, returning `{ url: string, expiresIn: number }` (upload/download) or `{ ok: true }` (delete).
- Presigned URLs expire after 900 s; uploads are limited to `application/pdf | application/zip | text/csv`.
- `keys.ts` exports `isAllowedKey(key: string): boolean`. It only allows `^[0-9a-f-]{36}/(papers|reports|exports|uploads)/[A-Za-z0-9._-]+$`, which blocks `..`, leading `/` and anything else.
- Uses `npm:aws4fetch@1` against `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{R2_BUCKET}/{key}`.

- [ ] **Step 1:** Deno test `keys.test.ts`: accepts `"<uuid>/papers/<uuid>.pdf"`; rejects `"../x"`, `"/abs"`, `"<uuid>/papers/../../etc"`, `""`, and `"<uuid>/other/x.pdf"`. Run `deno test supabase/functions/results-files/`; expected: FAIL.
- [ ] **Step 2:** Implement `keys.ts` and `index.ts` (CORS, JWT, role check via `supabase.rpc('is_manager_or_superadmin')` with the caller's auth header, then sign).
- [ ] **Step 3:** Deno test: PASS.
- [ ] **Step 4:** Deploy with `supabase functions deploy results-files --project-ref eucjeggfclztkbbupaav`. Smoke test: an upload URL for a test key, a `curl -X PUT` of a tiny PDF, a download URL, `curl` it and confirm the bytes match, then delete. Expected: all 200. This also proves the 4 R2 secrets.
- [ ] **Step 5:** Commit `feat(results): R2 presign function`.

## Phase 1 — Question Papers

### Task 5: Paper rules and data hooks

**Files:** Create `src/lib/results/paperRules.ts`, `src/lib/results/__tests__/paperRules.test.ts`, `src/hooks/results/usePapers.ts`

**Interfaces — Produces:**
- `olympiadsForClass(classCode: string): OlympiadCode[]`, using the Global Constraints mapping.
- `classGroup(classCode: string): 'lkg_ukg'|'class_1_2'|'class_3_5'|'class_6_8'`
- `readinessProblems(questions: QuestionRow[], total: number): string[]` returns plain-English problems, e.g. `"Questions 4, 17 have no answer and are not marked as grace"`, `"Questions 9 have no skill"`, `"Only 48 of 50 questions are entered"`. Returns `[]` when ready.
- Hooks: `usePapers(projectId)`, `usePaper(paperId)`, `useCreatePaper()`, `useSaveQuestions(paperId)` (a batch upsert of edited rows that sets `human_edited=true`), `useSetPaperStatus()` (refuses 'ready' when `readinessProblems` is non-empty), `useCopyPaperFromSlot(sourceId, targetId, { replace: boolean })` (copies the question rows and `pdf_r2_key`), `useSoftDeletePaper()`.

- [ ] **Step 1:** Tests:
  - `olympiadsForClass('14')` → `['KidsPO']`;
  - `olympiadsForClass('02')` → the 5 codes, no KidsPO;
  - `classGroup('05')` → `'class_3_5'`;
  - `readinessProblems`: (a) 50/50 complete → `[]`; (b) Q4 null and not grace → names "4"; (c) grace Q4 with null answer → OK; (d) 48 rows of 50 → the "Only 48 of 50" message; (e) a missing skill → named.
  - Copy guard: `useCopyPaperFromSlot` with `replace:false` on a target that has questions throws `"Slot 2 paper already has questions"`. Test the pure function `copyPlan(source, target, replace)` that it uses.
  Run; expected: FAIL.
- [ ] **Step 2:** Implement. Hooks use the generated types and TanStack Query, and invalidate `['results','papers',projectId]`.
- [ ] **Step 3:** `npm test`; expected: PASS. Commit `feat(results): paper rules and hooks`.

### Task 6: `analyze-paper` edge function (Claude Sonnet 5.5, chunked)

**Files:** Create `supabase/functions/analyze-paper/index.ts`, `supabase/functions/analyze-paper/parse.ts`, `supabase/functions/analyze-paper/parse.test.ts`

**Interfaces:**
- Consumes: `results-files` key rules; `result_skill_lists`; `question_papers`/`questions`.
- Produces: `POST /functions/v1/analyze-paper` with body `{ paperId: string, from: number, to: number, overwriteEdited: boolean }`, returning `{ saved: number, skippedEdited: number[], progress: number }`.
- The client calls it for `[1-20], [21-40], …` up to `total_questions`.
- Each call: downloads the PDF from R2 → `messages.create` with model `claude-sonnet-5-5`, the PDF as a base64 `document` block marked for prompt caching, a system prompt with the class, olympiad, allowed skill list and cognitive levels, and the instruction "only questions {from}–{to}; return null answer if no option is correct" → `output_config.format` JSON schema `{ questions: [{ question_number, question_text, has_figure, correct_answer: 'A'|'B'|'C'|'D'|null, skill_category (enum = allowed skills), skill_description, cognitive_level (enum), confidence 0–1 }] }`.
- Then `parse.ts` validates. Rows with `human_edited = true` are skipped unless `overwriteEdited`. Upsert, then set `analysis_progress = round(to/total*100)`; set `analysis_status='done'` when `to == total`. On error set `analysis_status='failed'` and `analysis_error` (plain English), and save nothing for that chunk.
- `parse.ts` is dependency-free: `validateChunk(raw: unknown, from: number, to: number, allowedSkills: string[]): { ok: true, rows: QuestionDraft[] } | { ok: false, message: string }`.

- [ ] **Step 1:** Deno tests for `validateChunk`:
  - (a) 20 valid rows → ok;
  - (b) 19 rows → `"The AI found 19 questions but expected 20 (questions 1–20) — please re-run this part"`;
  - (c) a duplicate number → error naming it;
  - (d) a number outside from–to → error;
  - (e) an answer `'E'` → error;
  - (f) a skill not in the list → error naming the question;
  - (g) null answer → ok, `is_grace` stays false so a human decides;
  - (h) confidence is clamped to 0–1.
  Run; expected: FAIL.
- [ ] **Step 2:** Implement `parse.ts`, then `index.ts`. The Anthropic call uses `fetch` to `https://api.anthropic.com/v1/messages` (Deno, no SDK) with headers `x-api-key`, `anthropic-version: 2023-06-01`. Read the structured-output shape from the claude-api skill's `shared/` docs before writing. Check `stop_reason` for `refusal`/`max_tokens` and turn either into a plain-English failure. `max_tokens` is 16000 per chunk.
- [ ] **Step 3:** Deno tests: PASS. Deploy. **Live smoke test on one real 2026 paper Goghul supplies:** all chunks succeed, the row count equals `total_questions`, and spot-checking 5 answers against the printed key shows they match. Report the results to Goghul. *(Blocked until `ANTHROPIC_API_KEY` is set.)*
- [ ] **Step 4:** Commit `feat(results): analyze-paper`.

### Task 7: Upload-with-progress utility

**Files:** Create `src/lib/results/uploadWithProgress.ts`, `src/lib/results/__tests__/uploadWithProgress.test.ts`, `src/components/results/ProgressPanel.tsx`

**Interfaces — Produces:**
- `uploadWithProgress(file: File, key: string, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void>`. It gets a presigned URL from `results-files`, then does an XHR `PUT` with `upload.onprogress` (fetch can't report upload progress).
- Rejects with plain English: `"Upload cancelled"`, `"The file is larger than 50 MB"`, `"Only PDF files can be uploaded here"`, `"Upload failed — check the internet connection and try again"`.
- `<ProgressPanel stage: string, percent: number, detail?: string, onCancel?: () => void />` renders the shared shadcn `Progress`, a large `{percent}%`, the stage label and a Cancel button. Every Results page reuses it.

- [ ] **Step 1:** Vitest with a mocked `XMLHttpRequest` and mocked presign:
  - progress events 25/50/100 → `onProgress` called with `[25,50,100]`;
  - abort → rejects "Upload cancelled";
  - a 51 MB file → rejects before any request;
  - a `.docx` → rejects;
  - a 500 response → rejects with "Upload failed…".
  Run; expected: FAIL.
- [ ] **Step 2:** Implement. Step 3: PASS. Commit `feat(results): upload with progress`.

### Task 8: Question Papers page

**Files:** Create `src/pages/results/QuestionPapersPage.tsx`, `src/components/results/papers/PaperGrid.tsx`, `CreatePaperDialog.tsx`, `PaperEditor.tsx`, `QuestionRowEditor.tsx`, `AnalyzeRunner.tsx`, `AnswerKeyExport.tsx`

**Interfaces:** Consumes Tasks 5, 6 and 7. Route `/results/papers` (list) and `/results/papers/:paperId` (editor).

What the page shows:
- **Grid:** rows = classes in order LKG, UKG, 1…8; columns = olympiads valid for that class; each cell has two chips, "Slot 1" and "Slot 2", each showing **Not created / Draft (n of N answered) / Ready**. Click opens the editor; "+" opens CreatePaperDialog pre-filled.
- **Editor header:** paper name ("Class 1 · Maths · Slot 2"), PDF status with **Upload PDF** (ProgressPanel, real %) / **View PDF**, **Analyse with AI** (AnalyzeRunner: loops through the chunks, ProgressPanel "Reading questions 21–40… 40%", Cancel stops after the current chunk). If edited questions exist, a confirm dialog lists how many will be kept, with "Keep my corrections" as the default.
- Also **Copy from Slot 1** (asks before replacing), **Download answer key** (CSV and PDF via jspdf, with ProgressPanel), and **Mark as Ready** (shows the `readinessProblems` list in an alert if blocked).
- **Question table:**
  - columns: #, question text (2 lines, expandable), a figure icon if `has_figure`, answer A/B/C/D as a 4-button toggle, a **Grace** switch (when on, the answer toggle is disabled and a note says "Every student gets this mark"), Skill (select from `result_skill_lists`), Cognitive level (select), AI confidence;
  - rows with confidence < 0.7 or `has_figure` are highlighted amber with "Please check".
  - Edits stay local until **Save changes** (a sticky footer showing the count of unsaved edits); leaving with unsaved edits asks first.

- [ ] **Step 1:** Load the `frontend-design` and `ui-ux-pro-max` skills and apply the Global Constraints UI rules.
- [ ] **Step 2:** Vitest + Testing Library (`npm i -D @testing-library/react @testing-library/user-event jsdom`; set `environment: 'jsdom'` for `*.tsx` tests). `PaperEditor.test.tsx`:
  - (a) toggling Grace disables the answer buttons;
  - (b) Mark as Ready with Q4 empty shows "Questions 4 have no answer…";
  - (c) a dirty state shows "1 unsaved change";
  - (d) re-analyse with edited rows opens the confirm dialog with "Keep my corrections" focused.
  Run; expected: FAIL.
- [ ] **Step 3:** Implement the components. Step 4: tests PASS; `npm run build` succeeds.
- [ ] **Step 5: Manual check in the browser** (`npm run dev`, logged in as a manager):
  - create Class 1 Maths Slot 1;
  - upload a PDF and watch the % rise;
  - analyse and watch 0→100%;
  - correct one answer, save, and confirm one `result_audit_log` row was written;
  - copy to Slot 2;
  - Mark Ready.
  Take screenshots for Goghul.
- [ ] **Step 6:** Commit `feat(results): question papers page`.

### Task 9: Phase close-out

- [ ] **Step 1:** Run `npm test`, `deno test supabase/functions/`, `npm run build`, and the SQL test. All pass.
- [ ] **Step 2:** Whole-branch review by a fresh reviewer against the spec and this plan.
- [ ] **Step 3:** Report to Goghul: what works, the screenshots, and any open items. **Ask before:** (a) deleting the deployed `olympiad-proxy` function, (b) building + uploading the deploy zip (the standard mPanel flow from the deployment memory).
