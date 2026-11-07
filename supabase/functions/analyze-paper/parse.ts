// Dependency-free validation of the AI's answer for one chunk of a paper.
export const COGNITIVE_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"] as const;
export const ANSWERS = ["A", "B", "C", "D"] as const;

export interface QuestionDraft {
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  has_figure: boolean;
  correct_answer: "A" | "B" | "C" | "D" | null;
  is_grace: false;
  skill_category: string;
  skill_description: string;
  cognitive_level: string;
  ai_confidence: number;
  ai_reason: string;
  figure_page: number | null;
  figure_box: FigureBox | null;
}

export interface FigureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** One sentence, at most `words` words. */
export function shortReason(v: unknown, words = 20): string {
  const parts = str(v).trim().split(/\s+/).filter(Boolean);
  return parts.length > words ? parts.slice(0, words).join(" ") + "…" : parts.join(" ");
}

/** Clean an AI page box: numbers clamped into the page; null when unusable. */
export function cleanBox(v: unknown): FigureBox | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const nums = ["x", "y", "w", "h"].map((k) => b[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const x = round(clamp01(nums[0] as number), 4), y = round(clamp01(nums[1] as number), 4);
  const w = round(Math.min(1 - x, Math.max(0, nums[2] as number)), 4);
  const h = round(Math.min(1 - y, Math.max(0, nums[3] as number)), 4);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export const confidence01 = (v: unknown) =>
  round(clamp01(typeof v === "number" && Number.isFinite(v) ? v : 0), 2);

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
    const hasFigure = q.has_figure === true;
    const page = hasFigure && typeof q.figure_page === "number" && Number.isInteger(q.figure_page) && q.figure_page >= 1
      ? q.figure_page
      : null;
    const box = page === null ? null : cleanBox(q.figure_box);
    rows.push({
      question_number: n,
      question_text: q.question_text,
      option_a: str(q.option_a),
      option_b: str(q.option_b),
      option_c: str(q.option_c),
      option_d: str(q.option_d),
      has_figure: hasFigure,
      correct_answer: ans as QuestionDraft["correct_answer"],
      is_grace: false, // a human decides grace; null answer is left for review
      skill_category: q.skill_category,
      skill_description: typeof q.skill_description === "string" ? q.skill_description : "",
      cognitive_level: q.cognitive_level,
      ai_confidence: confidence01(q.confidence),
      ai_reason: shortReason(q.reason),
      figure_page: box ? page : null,
      figure_box: box,
    });
  }
  rows.sort((a, b) => a.question_number - b.question_number);
  return { ok: true, rows };
}

export interface RecheckRow {
  question_number: number;
  answer: "A" | "B" | "C" | "D" | null;
  confidence: number;
  reason: string;
}
export type RecheckResult = { ok: true; rows: RecheckRow[] } | { ok: false; message: string };

/** The recheck must answer exactly the questions asked, once each. */
export function validateRecheck(raw: unknown, asked: number[]): RecheckResult {
  const list = (raw as { answers?: unknown })?.answers;
  const bad = (message: string): RecheckResult => ({ ok: false, message });
  if (!Array.isArray(list)) return bad("The AI's recheck was not in the expected form — please try again");
  const want = new Set(asked);
  const seen = new Set<number>();
  const rows: RecheckRow[] = [];
  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    const n = a.question_number;
    if (typeof n !== "number" || !want.has(n)) {
      return bad(`The AI rechecked question ${String(n)}, which was not asked — please try again`);
    }
    if (seen.has(n)) return bad(`The AI rechecked question ${n} twice — please try again`);
    seen.add(n);
    if (a.answer !== null && !(ANSWERS as readonly unknown[]).includes(a.answer)) {
      return bad(`The AI's recheck of question ${n} gave "${String(a.answer)}", which is not A, B, C or D — please try again`);
    }
    rows.push({
      question_number: n,
      answer: a.answer as RecheckRow["answer"],
      confidence: confidence01(a.confidence),
      reason: shortReason(a.reason, 25),
    });
  }
  const missing = asked.filter((n) => !seen.has(n)).sort((x, y) => x - y);
  if (missing.length) return bad(`The AI did not recheck question${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — please try again`);
  rows.sort((x, y) => x.question_number - y.question_number);
  return { ok: true, rows };
}

export interface KeyRow {
  question_number: number;
  answer: "A" | "B" | "C" | "D" | null;
}
export type KeyResult =
  | { ok: true; answers: KeyRow[]; missing: number[]; conflicts: number[] }
  | { ok: false; message: string };

/**
 * What the AI read from an answer key. Numbers outside 1..total are dropped; a number
 * read twice with different letters becomes null (staff must type it) and is listed in
 * conflicts. Returns one row per question 1..total (null where not read) for the grid.
 */
export function validateKey(raw: unknown, total: number): KeyResult {
  const list = (raw as { answers?: unknown })?.answers;
  if (!Array.isArray(list)) return { ok: false, message: "The AI could not read this answer key. Please try a clearer file, or type the answers." };
  const read = new Map<number, KeyRow["answer"]>();
  const conflicts = new Set<number>();
  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    const n = a.question_number;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > total) continue;
    const ans = (ANSWERS as readonly unknown[]).includes(a.answer) ? (a.answer as KeyRow["answer"]) : null;
    if (read.has(n) && read.get(n) !== ans) {
      conflicts.add(n);
      read.set(n, null);
    } else if (!conflicts.has(n)) {
      read.set(n, ans);
    }
  }
  if (![...read.values()].some((v) => v !== null)) {
    return { ok: false, message: "The AI could not find any answers in this file. Please check it is the answer key, or type the answers." };
  }
  const answers: KeyRow[] = [];
  const missing: number[] = [];
  for (let n = 1; n <= total; n++) {
    const ans = read.get(n) ?? null;
    if (ans === null) missing.push(n);
    answers.push({ question_number: n, answer: ans });
  }
  return { ok: true, answers, missing, conflicts: [...conflicts].sort((x, y) => x - y) };
}
