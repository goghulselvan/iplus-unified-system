// Builds the per-student PDF jobs for one school's score-sheet and skill-report zips.
// Shared by the School Results page (downloads) and Release & Send (uploads), so the two
// can never drift apart.
import type { RankRow } from "@/hooks/results/useResultsReads";
import { fetchFeedback, fetchSchoolSkills } from "@/hooks/results/useSkills";
import { generateScoreSheet, generateSkillReport } from "@/lib/results/pdf";
import {
  buildQuestionRows, fetchEvaluationAnswers, fetchPaperQuestions, fileSafe, groupTotals, rankOf, studentBlock,
  type GroupTotals, type QuestionKey,
} from "@/lib/results/pdfData";
import type { ZipFileInput } from "@/lib/results/zipParts";

const num = (v: unknown) => Number(v ?? 0);

export interface SchoolZipContext {
  projectId: string;
  schoolId: string;
  schoolName: string;
  className: (classCode: string) => string;
}
/** Lets the caller add cancel checks and progress around each PDF that is made. */
export type MakeWrap = (make: () => Promise<Blob>) => Promise<Blob>;
export interface Skipped { what: string; names: string[] }
export interface ZipJob { inputs: ZipFileInput[]; skipped: Skipped | null }
/** Nothing to make for this school (every student was skipped). */
export class NothingToMake extends Error {}

const pdfName = (r: RankRow) => `${fileSafe(r.student_name)} - ${r.registration_number}.pdf`;

export async function scoreSheetJob(ctx: SchoolZipContext, allRows: RankRow[], wrap: MakeWrap = (m) => m()): Promise<ZipJob> {
  const evals = await fetchEvaluationAnswers(allRows.map((r) => r.enrollment_id));
  const missing = allRows.filter((r) => !evals.has(r.enrollment_id));
  const rows = allRows.filter((r) => evals.has(r.enrollment_id));
  if (rows.length === 0) throw new NothingToMake("None of these students have answers on record, so no score sheets were made.");
  const qCache = new Map<string, QuestionKey[]>();
  const totals = new Map<string, GroupTotals>();
  const inputs = rows.map((r) => ({
    name: pdfName(r),
    make: () => wrap(async () => {
      const key = `${r.class_code}|${r.olympiad_code}`;
      if (!totals.has(key)) totals.set(key, await groupTotals(ctx.projectId, r.class_code, r.olympiad_code, { schoolId: ctx.schoolId, districtKey: r.district_key, stateCode: r.state_code }));
      const t = totals.get(key)!;
      const ev = evals.get(r.enrollment_id)!;
      const questions = buildQuestionRows(await fetchPaperQuestions(ev.paper_id, qCache), ev.answers, ev.marks);
      return generateScoreSheet({
        student: studentBlock({ name: r.student_name, reg: r.registration_number, className: ctx.className(r.class_code), olympiad: r.olympiad_code, school: ctx.schoolName }),
        score: {
          total: num(r.total), max: num(r.max_marks), percentage: num(r.percentage), grade: r.grade,
          ranks: { school: rankOf(r.rank_school, t.school), district: rankOf(r.rank_district, t.district), state: rankOf(r.rank_state, t.state), allIndia: rankOf(r.rank_national, t.national) },
        },
        questions,
      });
    }),
  }));
  return { inputs, skipped: missing.length ? { what: "had no answers on record, so no score sheet was made", names: missing.map((r) => r.student_name) } : null };
}

export async function skillReportJob(ctx: SchoolZipContext, allRows: RankRow[], wrap: MakeWrap = (m) => m()): Promise<ZipJob> {
  const [skills, fb] = await Promise.all([fetchSchoolSkills(ctx.projectId, ctx.schoolId), fetchFeedback(allRows.map((r) => r.enrollment_id))]);
  const none = allRows.filter((r) => !(skills.get(r.enrollment_id)?.length));
  const rows = allRows.filter((r) => skills.get(r.enrollment_id)?.length);
  if (rows.length === 0) throw new NothingToMake("None of these students have skill results, so no skill reports were made.");
  const inputs = rows.map((r) => ({
    name: pdfName(r),
    make: () => wrap(async () => {
      const f = fb.get(r.enrollment_id);
      return generateSkillReport({
        student: studentBlock({ name: r.student_name, reg: r.registration_number, className: ctx.className(r.class_code), olympiad: r.olympiad_code, school: ctx.schoolName }),
        skills: skills.get(r.enrollment_id) ?? [],
        feedback: f && !f.outdated ? f.feedback : null,
      });
    }),
  }));
  return { inputs, skipped: none.length ? { what: "had no skill results, so no skill report was made", names: none.map((r) => r.student_name) } : null };
}
