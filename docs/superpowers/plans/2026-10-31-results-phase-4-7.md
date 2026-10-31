# Results Phases 4–7 (Skills + AI feedback, PDFs + delivery, Integrity, Awards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** From scored results, produce skill analysis and AI feedback, generate student and school PDFs and size-capped zips, release and send to schools only with superadmin approval, flag suspicious patterns, and allot awards with letters and printer lists.

**Architecture:** Skill maths in SQL (unnest the answer arrays against `questions.skill_category`). AI feedback via one edge function that submits a Message Batch to Claude Haiku 5.5 (scores and skills only, never names) and collects the results into a table. PDFs and zips are built **in the browser** (jspdf + jszip, already dependencies), ported from the old app's generators, then downloaded; zip parts can also be uploaded to R2 for sending. Release writes `school_result_release`; sending is a staged queue a superadmin approves, with test mode. Integrity is a SQL scan into a flags table with a review workflow. Awards are rule-based plus manual edits.

**Tech Stack:** Postgres, Deno edge functions, Claude API (Message Batches, `claude-haiku-5-5`), React + jspdf + jszip, Resend (operational email), the existing WA template sender.

**Spec:** `docs/superpowers/specs/2026-10-31-results-module-design.md`. Depends on Phases 2–3 (`2026-10-31-results-phase-2-3.md`) being merged and applied.

## Global Constraints

- All Phase 0–3 constraints hold (migrations shown to Goghul and applied on his yes, plain English, % progress bars, soft deletes, audit, RLS via `is_manager_or_superadmin()`).
- **Superadmin only:** releasing results, clearing resend flags, approving and running any send. Check `profiles.role = 'superadmin'` server-side (`profiles.user_id = auth.uid()`), not just in the UI.
- **No autonomous sends.** Nothing is emailed or WhatsApped without a superadmin clicking Send on a staged batch. Test mode sends the whole batch to one address/number the superadmin types. Never resend rows that partly failed; show them, and Retry is per row and explicit.
- **AI:** feedback model `claude-haiku-5-5` via the Message Batches API; only class, olympiad, percentage band, grade and per-skill correct/total go to the API, **never names, registration numbers or school names**. Stored text is checked for the student's name and stripped if present. AI runs only on a click. A re-score marks affected feedback and reports **Outdated**.
- **PDFs:** WinAnsi-safe text (strip U+202F and other exotic spaces before drawing). Logos from `src/assets/iplus-logo.png`. Zips are split into parts of at most **25 MB** (`School name – Score sheets – Part 1 of 2.zip`).
- Email via Resend (CRM operational mail), with download links (R2 presigned GET, 7-day expiry) rather than attachments. WA via the existing AskEVA template path; WA needs a Meta-approved template whose name is configured in `notification_templates`. If none exists, the WA option shows "WhatsApp template not set up yet" and is disabled.
- Awards are **Goghul's 2026 classification**, entered as rules on the Awards page; nothing is hard-coded. Schools with a Verified integrity flag are excluded from automatic awards and listed for manual handling.

## Review Focus

1. **A re-score after feedback/PDFs exist.** Feedback and the school's reports show "Outdated, regenerate" and the school gets a resend flag only if a released student's score/grade/rank changed.
2. **A school whose skill-report zip exceeds 25 MB.** Split into parts in student order; no part over 25 MB; every student in exactly one part.
3. **A send batch where 3 of 40 emails fail.** The 37 are marked sent, the 3 failed with the reason; nothing is resent automatically; Retry only on the failed rows.
4. **A manager (not superadmin) calling the release or send RPC/function directly.** Refused server-side with a plain message.
5. **An AI batch that partly errors or expires.** Succeeded rows are stored; errored students are listed with "Try again for these 12 students".

---

### Task 1: Skills + feedback + send + integrity + awards schema (one migration) + SQL test

**Files:** `supabase/migrations/20261103_results_phase4_7.sql`, `supabase/tests/results_phase4_7.sql`.

**Produces:**
- `results_student_skills(p_enrollment_id uuid) returns table(skill text, correct numeric, total int, percentage int)`: grace questions count as correct; manual marks count fractional.
- `results_skill_summary(p_project_id uuid, p_school_id uuid, p_class_code text, p_olympiad_code text) returns table(skill text, school_pct int, state_pct int, students int)` (school_id null → project-wide).
- `result_feedback(enrollment_id uuid pk → portal_student_enrollments, feedback jsonb, model text, batch_id uuid, outdated boolean default false, created_at)`. Feedback JSON shape: `{"overall":"…","strengths":[{"skill":"…","feedback":"…"}],"focus_areas":[…],"tips":["…"],"goals":["…"]}`.
- `result_school_analysis(school_id, project_id, analysis jsonb, model, outdated, created_at, primary key (school_id, project_id))`.
- `result_ai_batches(id uuid pk, project_id, school_id null, kind text check in ('student_feedback'), anthropic_batch_id text, status text check in ('submitted','ended','collected','failed'), total int, succeeded int, errored int, created_by default auth.uid(), created_at, collected_at)`.
- `CREATE OR REPLACE results_rescore_paper` (ours, from Phase 2) additionally sets `result_feedback.outdated = true` and `result_school_analysis.outdated = true` for changed students/schools.
- `result_send_batches(id, project_id, channel text check in ('email','whatsapp'), test_target text null, status text check in ('staged','sending','done'), created_by, created_at, approved_by, approved_at)` and `result_send_items(id, batch_id, school_id, target text, payload jsonb, status text check in ('pending','sent','failed'), error text, sent_at, attempts int)`.
- RPCs (SECURITY DEFINER, superadmin-checked): `results_release_schools(p_project_id uuid, p_school_ids uuid[], p_notes text) returns int` (inserts `school_result_release`, skips already released), `results_unrelease_school(p_project_id, p_school_id)` (soft: keep a row in `result_audit_log`; deletes the release row only with superadmin, since that table is ours to manage per spec), `results_clear_resend_flag(p_flag_id)`, `results_stage_send(p_project_id, p_channel, p_school_ids uuid[], p_test_target text) returns uuid`.
- `result_integrity_flags(id uuid pk, project_id, school_id, class_code, olympiad_code, flag_type text check in ('identical_answers','same_wrong_answers','low_score_variance','far_above_state','adjacent_copying','answer_distribution_bias'), severity text check in ('medium','high','critical'), details jsonb, status text check in ('pending','investigating','verified','dismissed') default 'pending', notes text, reviewed_by, reviewed_at, created_at, scan_id uuid)`; `results_integrity_scan(p_project_id uuid) returns jsonb` (set-based checks; thresholds from the old `detect-malpractice` function: identical full answer strings within a school-class group of ≥3 → medium, ≥5 high, ≥10 critical; pairs sharing ≥60% of the same wrong answers (with ≥5 wrong) → high, ≥80% critical; school-class stddev of % <3 with ≥10 students → high, <2 critical; school avg ≥20 points above state → high, ≥30 critical; adjacent roll numbers (roll ±1, same school-class) with ≥90% identical answers chains ≥2 → high, ≥3 critical; one option chosen for >60% of answers by a school-class → medium). A re-scan replaces `pending` flags only; reviewed flags are kept.
- `result_award_rules(id, project_id, award_name text, level text check in ('national','state','district','school'), rule_type text check in ('top_n','min_percentage'), value numeric, class_code text null, olympiad_code text null, sort_order int)`; `result_awards(id, project_id, enrollment_id, award_name, source text check in ('rule','manual'), removed boolean default false, notes, created_by, created_at)`; `results_allot_awards(p_project_id) returns jsonb` (recomputes `source='rule'` rows from rules over `result_scores`; keeps manual rows; skips schools with a `verified` integrity flag and returns them in `manualReview`).
- RLS + REVOKE pattern as Phase 2; audit triggers on flags, awards, rules, send batches.
- SQL test: skills with a grace question; outdated set by a key change; manager calling `results_release_schools` gets `Only a superadmin can release results.`; integrity scan finds a planted identical group of 5 → severity high; award rule top_n=1 with a tie gives both students the award; a verified flag excludes that school.
- [ ] Write test → write migration → commit `feat(results): phase 4-7 schema (not applied)`. Controller applies on Goghul's yes.

### Task 2: `results-feedback` edge function (Message Batches, Haiku 5.5)

**Files:** `supabase/functions/results-feedback/{index.ts,prompt.ts,prompt.test.ts}`.

- POST `{action:'submit', projectId, schoolId?}`: manager-checked; selects evaluated enrolments without fresh feedback (none or outdated); builds one batch request per student, `custom_id` = enrolment id; body: `model: "claude-haiku-5-5"`, `max_tokens: 2000`, a fixed system prompt (encouraging, no numbers/percentages in text, no names, plain English for Indian school students and parents) with `cache_control` on it, user content = class, olympiad, grade label, per-skill `correct/total` list; `output_config.format` json_schema for the feedback shape. POST `https://api.anthropic.com/v1/messages/batches`; insert `result_ai_batches`.
- POST `{action:'status', batchId}`: GET the batch, update counts/status; returns `{status, total, succeeded, errored, percent}`.
- POST `{action:'collect', batchId}`: when ended, stream the results JSONL (line by line, never stringify the whole file), upsert `result_feedback` for succeeded rows (after `stripName`: remove the student's first/last name if present), return `{saved, failedEnrollmentIds}`.
- Same CORS/JWT/role/try-catch pattern as `analyze-paper`; headers `anthropic-version: 2026-10-21`.
- School AI analysis: `{action:'school', projectId, schoolId}` → one synchronous Messages call (Haiku 5.5) with the school's class×olympiad averages vs state and skill summary; upsert `result_school_analysis`.
- Tests (deno): request builder never includes a name/reg/school field; schema has `additionalProperties:false`; `stripName("Well done Arun!", "Arun Kumar")` → "Well done!"; JSONL line parser handles succeeded/errored/expired lines.
- [ ] Commit `feat(results): results-feedback function`. Controller deploys after review.

### Task 3: Skill Analysis page

**Files:** `src/pages/results/SkillAnalysisPage.tsx`, components. Route `/results/skills`.
- Project-wide skill table per class × olympiad (school vs state not applicable → state averages only) and per-school drill-down.
- **Generate AI feedback for all schools** → `submit`, then a ProgressPanel driven by `status` polling every 20 s while the page is open ("Claude is writing feedback: 3,120 of 8,000 students · 39%"); when ended, `collect` with its own progress; errors listed with "Try again for these N students". Also per-school "Generate AI analysis (this school)".
- Test: progress text from counts; error list rendering. Commit `feat(results): skill analysis page`.

### Task 4: PDF generators + zip builder

**Files:** `src/lib/results/pdf/{scoreSheet.ts,skillReport.ts,schoolSummary.ts,schoolRanking.ts,awardLetter.ts,text.ts}`, `src/lib/results/zipParts.ts`, tests.
- Port from `~/Desktop/Claude-workspace/iplusresults-main/src/lib/{scoreSheetPdfGenerator.ts,studentReportPdfGenerator.ts,pdfGenerators.ts}` keeping their look (logo header, watermark, grade colours from Phase 2 `grading.ts`), adapted to the new data (score row + `results_student_skills` + `result_feedback`). School ranking PDF: students in rank order with School/District/State/All-India rank columns. School summary: tiles + class×olympiad table + state comparison + AI school analysis if present. Each generator returns `Promise<Blob>`; `text.ts` exports `pdfSafe(s)` (WinAnsi).
- `buildZipParts(files: {name:string; blob:Blob}[], maxBytes = 25*1024*1024, onProgress): Promise<{name:string; blob:Blob}[]>`, packing in order, starting a new part before the limit is exceeded.
- Tests: `pdfSafe` strips U+202F; `buildZipParts` with fake 10 MB blobs ×6 → 3 parts, none over the cap, order kept; each generator returns a non-empty `application/pdf` Blob for a fixture (jsdom).
- Wire buttons: Student Result page (score sheet, skill report), School Result detail (school summary PDF, school ranking PDF, score-sheet zip, skill-report zip), each with ProgressPanel ("Making 37 of 212 score sheets · 17%"). Commit `feat(results): pdfs and zips`.

### Task 5: Release & Send page (superadmin)

**Files:** `src/pages/results/ReleaseSendPage.tsx`, `supabase/functions/results-send/index.ts`. Route `/results/release` (hidden from managers).
- Release tab: schools with evaluated/pending counts and readiness ("12 students still Pending"); select → **Release** with confirm ("Release results for 37 schools? Schools will be able to see them in the portal."); released list with Unrelease; resend flags with Clear.
- Send tab: choose channel, schools, test mode (one address/number) → **Stage** (shows the exact message preview and the list) → **Send now** (superadmin, second confirm) → `results-send` processes the staged items: for email, uploads/uses the school's zip parts in R2 under `{project_id}/{ss_no}/results/…` (generated in the browser before staging, with progress) and emails links via Resend; checks `{ error }` from Resend on every send (it never throws); per-item status. History list with per-row Retry for failed rows only.
- Test: the Stage button is absent for a manager; a failed item shows Retry and a sent one doesn't. Commit `feat(results): release and send`.

### Task 6: Integrity Checks page

**Files:** `src/pages/results/IntegrityPage.tsx`. Route `/results/integrity`.
- **Run scan** (progress), filters severity / type / status / school, flag cards with plain-English explanations ("5 students in Class 4 Maths at ABC School gave exactly the same answers"), detail drawer with the students involved and their answer strings side by side, status workflow Pending → Investigating → Verified / Dismissed with a required note. Commit `feat(results): integrity checks`.

### Task 7: Awards & Certificates page

**Files:** `src/pages/results/AwardsPage.tsx`, `src/lib/results/printerCsv.ts`. Route `/results/awards`.
- Rules editor (award name, level, Top N or ≥%, optional class/olympiad) → **Allot awards** (progress, summary per award, the manual-review schools list). Award list with filters; manual add/remove with a note.
- Exports: **Award letters PDF** per school; **Achievers CSV** and **Participation CSV** for the certificate printer (columns: Reg no, Name, Class, Olympiad, School, Award); **Courier pack data** JSON in the shape `~/Desktop/Claude-workspace/slot_dispatch_pdfs/packs.mjs` reads (read it; produce the matching `schools.json`-style export).
- Test: printer CSV columns and quoting. Commit `feat(results): awards and certificates`.

### Task 8: Portal results section (separate repo `iplus-olympiad-spark`)

- Rewrite `src/hooks/usePortalResults.ts` to read the new tables, **only for released schools** (gate on `school_result_release`), via new SECURITY DEFINER RPC `portal_school_results(p_project_id)` that resolves the caller's school from the portal user mapping (inspect how the portal identifies a school; add the RPC in the Task 1 migration if the mapping is clear, else a follow-up migration). Built, not announced ("only the CRM view is used for now"). Commit in that repo on a branch; no deploy.

### Task 9: Close-out

- Whole-branch review (most capable model), one fix round, tests + build green. Ask Goghul before: deploying edge functions, pushing, building/uploading the CRM zip, deleting `olympiad-proxy`.
