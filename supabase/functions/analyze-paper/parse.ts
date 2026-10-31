// Dependency-free validation of the AI's answer for one chunk of a paper.
export const COGNITIVE_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"] as const;
export const ANSWERS = ["A", "B", "C", "D"] as const;

export interface QuestionDraft {
  question_number: number;
  question_text: string;
  has_figure: boolean;
  correct_answer: "A" | "B" | "C" | "D" | null;
  is_grace: false;
  skill_category: string;
  skill_description: string;
  cognitive_level: string;
  ai_confidence: number;
}

export type ChunkResult = { ok: true; rows: QuestionDraft[] } | { ok: false; message: string };

const fail = (message: string): ChunkResult => ({ ok: false, message });

export function validateChunk(raw: unknown, from: number, to: number, allowedSkills: string[]): ChunkResult {
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return fail("The AI's answer was not in the expected form — please re-run this part");
  const expected = to - from + 1;
  if (list.length !== expected) {
    return fail(
      `The AI found ${list.length} questions but expected ${expected} (questions ${from}–${to}) — please re-run this part`,
    );
  }
  const seen = new Set<number>();
  const rows: QuestionDraft[] = [];
  for (const item of list) {
    const q = (item ?? {}) as Record<string, unknown>;
    const n = q.question_number;
    if (typeof n !== "number" || !Number.isInteger(n)) {
      return fail("The AI returned a question without a valid number — please re-run this part");
    }
    if (n < from || n > to) {
      return fail(`The AI returned question ${n}, which is outside questions ${from}–${to} — please re-run this part`);
    }
    if (seen.has(n)) return fail(`The AI returned question ${n} twice — please re-run this part`);
    seen.add(n);
    const ans = q.correct_answer;
    if (ans !== null && !(ANSWERS as readonly unknown[]).includes(ans)) {
      return fail(`Question ${n} has an answer the AI gave as "${String(ans)}", which is not A, B, C or D — please re-run this part`);
    }
    if (typeof q.skill_category !== "string" || !allowedSkills.includes(q.skill_category)) {
      return fail(`Question ${n} was given a skill that is not on the allowed list — please re-run this part`);
    }
    if (typeof q.cognitive_level !== "string" || !(COGNITIVE_LEVELS as readonly string[]).includes(q.cognitive_level)) {
      return fail(`Question ${n} was given an unknown thinking level — please re-run this part`);
    }
    if (typeof q.question_text !== "string" || q.question_text.trim() === "") {
      return fail(`The AI could not read question ${n} — please re-run this part`);
    }
    const c = typeof q.confidence === "number" && Number.isFinite(q.confidence) ? q.confidence : 0;
    rows.push({
      question_number: n,
      question_text: q.question_text,
      has_figure: q.has_figure === true,
      correct_answer: ans as QuestionDraft["correct_answer"],
      is_grace: false, // a human decides grace; null answer is left for review
      skill_category: q.skill_category,
      skill_description: typeof q.skill_description === "string" ? q.skill_description : "",
      cognitive_level: q.cognitive_level,
      ai_confidence: Math.round(Math.min(1, Math.max(0, c)) * 100) / 100,
    });
  }
  rows.sort((a, b) => a.question_number - b.question_number);
  return { ok: true, rows };
}
