import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/results/friendlyError";
import { fetchRankPage, RANK_PAGE, type RankRow } from "@/hooks/results/useResultsReads";
import { formatReg } from "./regNumber";
import { acceptedLabel, answerOk } from "./accepted";
import { OLYMPIAD_NAMES, type OlympiadCode } from "./paperRules";
import type { ScoreSheetInput, StudentBlock, RankOf } from "./pdf";

export interface QuestionKey { question_number: number; correct_answer: string | null; also_correct?: string | null; is_grace: boolean; skill_category: string | null }

/** Per-question rows for a score sheet, built the same way as the on-screen answer review. */
export function buildQuestionRows(
  questions: QuestionKey[], answers: (string | null)[] | null, marks: (number | null)[] | null,
): ScoreSheetInput["questions"] {
  const omr = !!answers;
  const values = (answers ?? marks ?? []) as (string | number | null)[];
  const count = Math.max(questions.length, values.length);
  return Array.from({ length: count }, (_, i) => {
    const q = questions.find((x) => x.question_number === i + 1);
    const v = values[i] ?? null;
    let result: "✓" | "✗" | "½" = "✗";
    if (q?.is_grace) result = "✓";
    else if (omr) result = answerOk(v as string | null, q) ? "✓" : "✗";
    else result = Number(v) === 1 ? "✓" : Number(v) === 0.5 ? "½" : "✗";
    return {
      number: i + 1,
      studentAnswer: v === null || v === "" ? null : String(v),
      correctAnswer: q?.is_grace ? "Grace" : omr ? acceptedLabel(q) || "-" : "1",
      result,
      skill: q?.skill_category ?? "",
    };
  });
}

export const olympiadName = (code: string) => OLYMPIAD_NAMES[code as OlympiadCode] ?? code;

export const studentBlock = (o: { name: string; reg: string | null; className: string; olympiad: string; school: string }): StudentBlock => ({
  name: o.name, regNo: o.reg ? formatReg(o.reg) : "-", className: o.className, olympiad: olympiadName(o.olympiad), schoolName: o.school,
});

export const rankOf = (rank: number | null | undefined, of: number | null | undefined): RankOf => ({ rank: rank ?? null, of: of ?? null });

export interface GroupTotals { school: number; district: number; state: number; national: number }

async function countScores(projectId: string, classCode: string, olympiad: string, col?: "school_id" | "district_key" | "state_code", val?: string | null) {
  let q = supabase.from("result_scores").select("enrollment_id", { count: "exact", head: true })
    .eq("project_id", projectId).eq("class_code", classCode).eq("olympiad_code", olympiad);
  if (col) { if (!val) return 0; q = q.eq(col, val); }
  const { count, error } = await q;
  if (error) throw friendlyError(error, "We could not count the students for the ranks.");
  return count ?? 0;
}

/** How many students are ranked at each level for one class x olympiad, for a school in a given district/state. */
export async function groupTotals(projectId: string, classCode: string, olympiad: string, ids: { schoolId: string; districtKey: string | null; stateCode: string | null }): Promise<GroupTotals> {
  const [school, district, state, national] = await Promise.all([
    countScores(projectId, classCode, olympiad, "school_id", ids.schoolId),
    countScores(projectId, classCode, olympiad, "district_key", ids.districtKey),
    countScores(projectId, classCode, olympiad, "state_code", ids.stateCode),
    countScores(projectId, classCode, olympiad),
  ]);
  return { school, district, state, national };
}

/** Every ranked student of one school, class by class, in rank order within each class and olympiad. */
export async function fetchSchoolRankRows(projectId: string, schoolId: string, combos: { class_code: string; olympiad_code: string }[]): Promise<RankRow[]> {
  const out: RankRow[] = [];
  for (const c of combos) {
    for (let off = 0;; off += RANK_PAGE) {
      const page = await fetchRankPage(projectId, c.class_code, c.olympiad_code, { schoolId }, RANK_PAGE, off);
      out.push(...page);
      if (page.length < RANK_PAGE) break;
    }
  }
  return out;
}

export interface EvalAnswers { answers: (string | null)[] | null; marks: (number | null)[] | null; paper_id: string }

export async function fetchEvaluationAnswers(enrollmentIds: string[]): Promise<Map<string, EvalAnswers>> {
  const out = new Map<string, EvalAnswers>();
  for (let i = 0; i < enrollmentIds.length; i += 100) {
    const { data, error } = await supabase.from("result_evaluations").select("enrollment_id, answers, marks, paper_id")
      .in("enrollment_id", enrollmentIds.slice(i, i + 100)).is("deleted_at", null).eq("status", "evaluated");
    if (error) throw friendlyError(error, "We could not load the students' answers.");
    for (const r of (data ?? []) as unknown as (EvalAnswers & { enrollment_id: string })[]) out.set(r.enrollment_id, r);
  }
  return out;
}

export async function fetchPaperQuestions(paperId: string, cache: Map<string, QuestionKey[]>): Promise<QuestionKey[]> {
  const hit = cache.get(paperId);
  if (hit) return hit;
  const { data, error } = await supabase.from("questions").select("question_number, correct_answer, also_correct, is_grace, skill_category")
    .eq("paper_id", paperId).order("question_number");
  if (error) throw friendlyError(error, "We could not load the question paper.");
  const rows = (data ?? []) as QuestionKey[];
  cache.set(paperId, rows);
  return rows;
}

/** Safe file name part: no slashes etc., single spaces. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Student";
