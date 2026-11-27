import { keyUploadPatch, needsRecheck, type KeyCheckFields } from "./keyCheck";
import type { Letter } from "./questionRow";

export interface KeyPlan {
  /** Only questions whose key actually changes. */
  rows: { question_number: number; key_answer: Letter | null; correct_answer: Letter | null; is_grace: boolean; check_status: string }[];
  /** Questions whose key differs from the AI's answer; these need an automatic recheck. */
  toRecheck: number[];
  /** Answers in the key for question numbers beyond the paper's question count. */
  unmatched: number[];
  /** Questions where the key is the same as the one already saved. */
  unchanged: number;
}

type PlanQuestion = KeyCheckFields & { question_number: number; correct_answer: string | null; is_grace: boolean };

/**
 * What saving an answer key changes, decided by Part A's keyUploadPatch. Earlier
 * rechecks were against the old key, so they are cleared for changed questions
 * (done by the save) and the status is worked out as if they had not happened.
 * The key may come before the AI has read the paper: questions 1..totalQuestions not
 * read yet get a row holding just the key, and the AI fills in the text later and
 * cross-checks against it.
 */
export function planKeySave(questions: PlanQuestion[], answers: Record<number, Letter>, totalQuestions: number): KeyPlan {
  const rows: KeyPlan["rows"] = [];
  const toRecheck: number[] = [];
  const known = new Set<number>();
  let unchanged = 0;
  for (const q of questions) {
    known.add(q.question_number);
    const key = answers[q.question_number];
    if (!key) continue;
    if (key === q.key_answer) { unchanged++; continue; }
    const cleared = { ...q, recheck_answer: null, recheck_confidence: null, rechecked_at: null };
    const patch = keyUploadPatch(cleared, key);
    rows.push({ question_number: q.question_number, ...patch });
    if (needsRecheck({ ...cleared, ...patch })) toRecheck.push(q.question_number);
  }
  const unmatched: number[] = [];
  for (const n of Object.keys(answers).map(Number).sort((a, b) => a - b)) {
    if (known.has(n)) continue;
    if (n < 1 || n > totalQuestions) { unmatched.push(n); continue; }
    const blank = { key_answer: null, ai_answer: null, check_status: "unchecked", correct_answer: null, is_grace: false };
    rows.push({ question_number: n, ...keyUploadPatch(blank, answers[n]) });
  }
  return { rows, toRecheck, unmatched, unchanged };
}
