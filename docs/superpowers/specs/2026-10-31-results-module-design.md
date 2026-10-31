# Results & Analysis Module — Design

**Status:** draft for Goghul's approval · **Date:** 2026-10-31 · **Deadline:** results out by mid-November 2026

## 1. Intent

The old results software is a separate Lovable app with its own database, linked to the CRM by a
relay function. Staff copy students across by CSV, and that causes clerical errors. This module
moves the useful 20% of it into the CRM. It reads the CRM's own students and registration numbers,
so nothing is copied.

Goghul: *"we do not want to recreate it but we do want all the function it had… just the 20% of
whole software essence."*

**Success:** every Slot 1 and Slot 2 school receives a correct rank list, score sheets and skill
reports by mid-November. Certificates and prizes are couriered after that. No staff member types a
student twice. Nothing reaches a school without a superadmin's approval.

## 2. Goals, non-goals, anti-goals

**Goals:** papers and answer keys → evaluation from CSV → scores and ranks → skill analysis and
AI feedback → student and school PDFs → zipped delivery by email and WA → awards and certificate
lists → malpractice flags.

**Non-goals:**
- Parent logins, a public result lookup, a school dispute flow (disputes are handled by phone).
- Withholding results for unpaid dues.
- Any 2025 data.
- A district average.

**Anti-goals (a failure even if it "works"):**
- A partial CSV upload.
- A result or message reaching a school before superadmin approval.
- Skill tags the AI produced without reading the question (the old `analyze-skills` bug).
- An export button that changes data.
- A delete that can't be undone.
- An error message staff can't understand.

## 3. Constraints

- **Same database as the CRM** (`eucjeggfclztkbbupaav`), still on the **free plan**: 500 MB
  database, about 236 MB used. Goghul will upgrade to Pro manually after the build; do not upgrade.
  Add a size warning.
- **Every migration is shown to Goghul and confirmed before it is applied.** This is production.
- **PDFs are stored in Cloudflare R2** (activated 10-31, 10 GB free, no download fees). Supabase
  Storage holds no result files. An optional nightly copy to Google Drive comes later.
- **Scale target:** 500k schools, 5M students eventually. Answer rows (one per student per
  question) are the largest table. Insert in batches, index on (paper, enrolment).
- **Retention:** keep answer rows for 2 years, then archive. Scores, ranks and PDFs stay.
- Roles: superadmin, manager, accountant ([[project_crm_roles_permissions]]). Results are for
  **superadmin and manager only**.
- Comms follow the no-autonomous-sends rule. Every send is staged, then approved.

## 4. Live facts the design rests on (checked 2026-10-31)

- **Student-subject records come from `portal_student_enrollments`** (8,312 rows, one per student
  per olympiad). Each has a `registration_number`, and the student's class is on `students`. This
  is the record that gets a result.
- **Registration numbers are stored with hyphens.** For example `3-29-02-01-01-002` is 12 digits
  plus 5 hyphens. OMR CSVs will most likely contain digits only. Matching compares digits only, on
  both sides.
- **The first digit identifies the olympiad:** 1 EPO, 2 MPO, 3 SPO, 4 GKSSPO, 5 LRPO, 9 KidsPO.
  ⚠️ **The leftover `subjects` table is wrong.** It has 0 Overall, 1 English, 2 Maths, 3 Science,
  4 GK, 5 Kids. It has no Logical Reasoning, puts Kids at 5 (live Kids numbers start with 9), and
  makes 5 Kids where live 5 is LRPO. Papers and scoring must key on the olympiad code, not this
  table.
- **One EPO enrolment has no registration number.** The upload must report it, not crash on it.
- **Leftover tables from the Lovable unification, all with 0 rows:** `question_papers`,
  `questions`, `student_responses`, `student_skill_analysis`, `student_reports`, `analysis_jobs`,
  `result_students`, `olympiad_results`, `school_analysis`, `awards`, `school_flags`,
  `school_result_release`.
  ⚠️ **`student_responses`, `student_reports` and `student_skill_analysis` point to
  `result_students`**, a copy of the student list. Using them as they are would rebuild the copy
  problem. **Decision:** point all result tables at `portal_student_enrollments.id`, and retire
  `result_students` and `olympiad_results`.
- **`classes` already holds the question counts Goghul gave:** LKG/UKG 30, Class 1–2 40,
  Class 3–5 50, Class 6–8 60.
- Exam slots are booked per school (`exam_slot_*` tables). Slot 1 ran 13–15 Oct; Slot 2 is 10–12 Nov.
- The CRM school page already has a **Results** tab (`SchoolResultsSummary`), and there is a
  `Results.tsx` page. Both read the old app through the `olympiad-proxy` edge function. **Both get
  replaced. The relay is removed. The old Lovable project is left untouched as an archive.**
- The release gate already exists: the `school_result_release` table and `PortalResultsRelease.tsx`.

## 5. What Goghul decided

| Topic | Decision |
|---|---|
| Who does what | **Managers do the work with no approval step:** upload papers, run and correct the AI analysis (answers + skills), upload answer CSVs, mark absent. **Superadmin approval is only for results:** a school's results are released, and anything is sent, only after a superadmin approves |
| Paper per slot | One paper record per **class × olympiad × slot** (e.g. "Class 1 Maths – Slot 1", "Class 1 Maths – Slot 2"). This year both slots use the same questions, so offer "copy from Slot 1". **When uploading a CSV, staff pick the paper to evaluate against.** *Builder's call:* warn (don't block) if the CSV has students from schools booked on the other slot |
| Olympiads per class | **LKG/UKG: Kids olympiad only. Class 1–2: EPO, MPO, SPO, GKSSPO, LRPO** (5). Classes 3–8 as registered |
| Cognitive level | **Keep** (Remember / Understand / Apply / Analyze / Evaluate / Create) |
| Paper input | Upload the question paper as a **digital PDF (not a scan)**; the AI reads the **real question text** and proposes the answer + skill per question; a person approves or changes each. A CSV template is the fallback |
| Answer CSV, Class 3–8 | OMR scan output, one row per student, answers A–D |
| Marks CSV, LKG–Class 2 | Hand-marked, per student per question: **0 wrong, 0.5 partial, 1 correct** |
| Upload validation | **All or nothing.** Any unknown or unregistered registration number → the whole file is rejected, with each bad row listed in plain English (e.g. "Row 14: 3290201010099 is not a registered student in this project"). Nothing is saved until the file is clean |
| Absent | Shown as "Absent", with no evaluation data. Manager or superadmin can mark a student absent |
| Grace mark | For a printing error or a question with no right answer, **everyone gets the mark** |
| Answer-key change | **Automatic re-score.** Schools already released are flagged for an approved resend |
| Name correction after release | Regenerate **that one student's** PDFs only |
| Scoring | No negative marking. `total = COALESCE(SUM(score), COUNT(*) FILTER (WHERE is_correct))`; percentage rounded; manual classes test `score > 0` |
| Ranks | `RANK()` with ties. Within school, district, state and national, **per class per olympiad**. **Slot 1 and Slot 2 are combined** (papers are equivalent or identical) |
| Grades | Carried over unchanged from the old app (`iplusresults-main/src/lib/grading.ts`). **Student:** ≥95 A++ Olympiad Excellence · ≥90 A+ National Level Potential · ≥80 A High Performer · ≥70 B+ Strong Foundation · ≥60 B Satisfactory · ≥50 C Average · <50 D Needs Academic Support. **School:** ≥80 A Excellent · ≥60 B Good · ≥40 C Average · <40 D Needs Improvement |
| District / state for ranks and the state average | *Builder's call:* read from the registration number's state and district codes. Those are what is printed and issued, and they come from `district_codes`. If a school's address disagrees, the number wins and the mismatch is listed for staff |
| Re-score resend scope | *Builder's call:* flag a released school for resend only if at least one of its students' score, grade or rank actually changed |
| Comparison | School vs **state average only**. No district or national average |
| Outputs | Student score sheet, student skill report, school performance summary, school report (mark statement), rank lists |
| Release + delivery timing | **One release for all schools after Slot 2 is evaluated** (~20–25 Nov). At the deadline, staff **download the zip from the CRM** and send it themselves; the staged automated send follows later |
| Where PDFs appear | (a) CRM school page → Results tab, staff, any time. (b) School portal → Results, only after release. **Only (a) is used for now** |
| Delivery | Skill reports to **schools** by email + WA, as a **zip of 20–25 MB at most**, split into Part 1/2/… if larger. Only after superadmin approval |
| Certificates and prizes | Printed and couriered. Award and participation lists feed the printer; parcels reuse the slot-dispatch scripts and design (`~/Desktop/Claude-workspace/slot_dispatch_pdfs/`) |
| Awards | **Last phase.** Goghul allots prizes after the analysis, using his 2026 classification |
| Malpractice | Wanted. Flags let staff handle those schools' prizes by hand. Flags never act on their own |
| AI provider | *Recommended, awaiting Goghul:* Claude. **Opus 5.5** reads question PDFs (Phase 1); **Haiku 5.5** writes per-student feedback (Phase 4, via the Batch API). Only scores and skills are sent, never student names. AI text is name-stripped before storage |
| Unpaid schools | Treated the same as paid ones |

## 6. Parity with the old software (from `~/Downloads/2025 iplus resultus-buttons-flowchart.md`)

**Keep:**
- Overwrite warning + downloadable list on re-upload.
- Bulk Mark Absent / Present, with a confirmation.
- Delete evaluation (keep the student), with a confirmation and a log entry.
- Per-question correction on the student page, **logged** (who changed what, and when).
- Registered-vs-Evaluated report per school.
- CSV templates per class.
- AI school analysis.
- Score-sheet + school PDFs.
- Rank list CSV.
- Award distribution (quotas, manual add/remove, award letters as PDF).
- Achiever + Participation CSVs.
- Integrity checks (severity and pattern filters; Pending → Investigating → Verified / Dismissed).
- Send history with Retry + **test mode** (send everything to one address first), for email **and** WA.

**Change:**
- Every delete becomes a soft delete, recoverable for 30 days.
- Every instant write is logged.
- Exports never write.

**Drop:**
- Student import, Update Names CSV (names live in the CRM), user management, backup, migration export.
- The `crm-proxy` / `olympiad-proxy` relay.
- `analyze-skills`.

**Undecided:** the cognitive-level field (Remember / Understand / Apply…). Goghul to say.

## 7. Phases (ordered by the mid-November deadline)

0. **Schema diff + fixes.** Repoint the FKs to enrolments; fix or replace the olympiad/subject
   mapping; add paper set/slot, grace-mark and answer-key versioning; add audit + soft-delete
   columns; set up R2 secrets. Remove the relay and the old Results tab.
1. **Papers & questions.** PDF → AI proposal → human approval; CSV fallback; answer-key edit;
   grace mark.
2. **Evaluation.** Both CSV uploads with all-or-nothing validation; absent marking; overwrite
   warning; re-score.
3. **Results & ranks.** Scores, grades, 4-level ranks, combined slots, Registered-vs-Evaluated,
   new school-page Results tab, release gate.
4. **Skill analysis + AI feedback.** Pick the provider; per-student skill mastery; feedback text.
5. **PDFs + delivery.** Generate into R2; zips split at 25 MB; staged email/WA with test mode;
   send history; portal Results section (built, unused).
6. **Integrity checks.**
7. **Awards + certificates.** Goghul's classification; award letters; printer CSVs; courier
   parcels via the dispatch scripts.

**The minimum for mid-November is phases 0–3 plus the score-sheet PDF from phase 5.** Skill
reports follow immediately after.

## 8. Open items

1. **OMR CSV format.** No sample exists yet. *Builder's call:* publish our own CSV template
   (one row per student: registration number, Q1…Qn as A–D, blank = unanswered) and give it to
   the OMR operator. Let staff map columns if the operator's file differs. Accept registration
   numbers with or without hyphens.
2. **Logical Reasoning skill list.** Drafted in the appendix, awaiting Goghul's approval.
3. **AI provider.** Claude recommended (Opus 5.5 for papers, Haiku 5.5 for feedback). Goghul
   asked about NVIDIA's free tier, answered 10-31; awaiting the final pick and the API key.

## 9. Left to the builder

Table and column names, indexes, edge-function split, PDF library (pdf-lib is already used in the
CRM edge functions; mind the WinAnsi crash), UI layout following existing CRM pages, R2 bucket
layout (`{project}/{ss_no}/{class}/{olympiad}/…`), signed-URL expiry for staff downloads.

## Appendix A — Logical Reasoning skill list (DRAFT, needs Goghul's approval)

- **Class 1–2:** Patterns & Sequences · Odd One Out · Picture Analogies · Spatial Sense & Directions · Counting Figures · Classification & Grouping · Mirror Images · Simple Puzzles
- **Class 3–5:** Number & Letter Series · Analogies · Classification · Coding–Decoding · Directions & Distance · Ranking & Ordering · Mirror & Water Images · Figure Counting & Embedded Figures · Calendar & Time Puzzles
- **Class 6–8:** Series Completion · Analogies · Classification · Coding–Decoding · Blood Relations · Direction Sense · Ranking & Arrangement · Venn Diagrams & Syllogisms · Non-Verbal Reasoning (figure series, paper folding & cutting, mirror/water images) · Calendar & Clock · Logical Puzzles

The other olympiads reuse the old app's lists (`iplusresults-main/supabase/functions/analyze-skills/index.ts`, `SKILLS_BY_CLASS_SUBJECT`), keyed by the CRM's olympiad codes, not its old subject numbers. Kids olympiad uses the LKG/UKG list.

## Appendix B — Pages (agreed 2026-10-31)

1. **Results Dashboard**: live counts (papers ready, evaluated per slot, registered vs evaluated, awaiting release).
2. **Question Papers**: one per class × olympiad × slot; PDF → AI answers/skills/cognitive level → staff correct; copy from Slot 1; grace mark; answer-key download.
3. **Upload Answers**: two tabs. **Manual (LKG–Class 2, 0/0.5/1)** and **OMR (Class 3–8, A–D)**. Pick the paper → CSV → plain-English check → overwrite warning → confirm. Templates per class.
4. **Students & Attendance**: filters; bulk absent/present; undoable delete of results.
5. **Student Result**: score, grade, 4 ranks, answer review with logged corrections, score-sheet + skill-report PDFs.
6. **Rankings**: per class × olympiad at 4 levels; CSV; Registered-vs-Evaluated.
7. **Skill Analysis**: "Generate AI analysis for all schools" with progress and errors.
8. **School Results**: all schools with average, grade vs state average, release status. **Click a school → School Result detail:** tiles (enrolled, evaluated, absent, pending, school average, grade vs state average), class × olympiad table, clickable student list, and buttons for **Generate AI analysis (this school)**, school analysis PDF, school ranking PDF, score-sheet zip and skill-report zip (≤25 MB parts).
9. **Release & Send** (superadmin): approve release per school or in bulk; staged email + WA sends with test mode; history and retry.
10. **Integrity Checks**: scan, flags, review workflow.
11. **Awards & Certificates** (last): allotment, award letters, printer lists, courier packs.

AI runs only when a user clicks. A re-score marks existing reports as outdated. The CRM school page's Results tab shows a summary and links to the School Result detail page; it is not a second copy.
