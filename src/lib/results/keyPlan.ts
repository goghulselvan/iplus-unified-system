import { keyUploadPatch, needsRecheck, type KeyCheckFields } from "./keyCheck";
import type { Letter } from "./questionRow";

export interface KeyPlan {
  /** Only questions whose key actually changes. */
  rows: { question_number: number; key_answer: Letter | null; correct_answer: Letter | null; check_status: string }[];
  /** Questions whose key differs from the AI's answer; these need an automatic recheck. */
  toRecheck: number[];
  /** Answers in the key for questions that do not exist on this paper yet. */
  unmatched: number[];
  /** Questions where the key is the same as the one already saved. */
  unchanged: number;
}

type PlanQuestion = KeyCheckFields & { question_number: number; correct_answer: string | null };

/**
 * What saving an answer key changes, decided by Part A's keyUploadPatch. Earlier
 * rechecks were against the old key, so they are cleared for changed questions
 * (done by the save) and the status is worked out as if they had not happened.
 */
export function planKeySave(questions: PlanQuestion[], answers: Record<number, Letter>): KeyPlan {
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
  const unmatched = Object.keys(answers).map(Number).filter((n) => !known.has(n));
  return { rows, toRecheck, unmatched, unchanged };
}
