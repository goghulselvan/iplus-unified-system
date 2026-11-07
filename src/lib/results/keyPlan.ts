import { checkStatus } from "./keyCheck";
import type { Letter, KeyFields } from "./questionRow";
import type { QuestionRow } from "./paperRules";

export interface KeyPlan {
  rows: { question_number: number; key_answer: Letter; correct_answer: string | null; check_status: string }[];
  /** Questions whose key differs from the AI's answer; these need an automatic recheck. */
  toRecheck: number[];
  /** Answers in the key for questions that do not exist on this paper yet. */
  unmatched: number[];
}

type PlanQuestion = Pick<QuestionRow, "question_number" | "correct_answer" | "is_grace"> &
  Pick<KeyFields, "ai_answer" | "check_status">;

/**
 * What saving an answer key changes. The key wins by default: correct_answer
 * becomes the key unless a person already decided that question (resolved) or marked grace.
 */
export function planKeySave(questions: PlanQuestion[], answers: Record<number, Letter>): KeyPlan {
  const rows: KeyPlan["rows"] = [];
  const toRecheck: number[] = [];
  const known = new Set<number>();
  for (const q of questions) {
    known.add(q.question_number);
    const key = answers[q.question_number];
    if (!key) continue;
    const resolved = q.check_status === "resolved";
    const status = checkStatus({
      key_answer: key, ai_answer: q.ai_answer, recheck_answer: null, recheck_confidence: null,
      rechecked_at: null, check_status: resolved ? "resolved" : "unchecked",
    });
    rows.push({
      question_number: q.question_number,
      key_answer: key,
      correct_answer: resolved || q.is_grace ? q.correct_answer : key,
      check_status: status,
    });
    if (status === "mismatch") toRecheck.push(q.question_number);
  }
  const unmatched = Object.keys(answers).map(Number).filter((n) => !known.has(n));
  return { rows, toRecheck, unmatched };
}
