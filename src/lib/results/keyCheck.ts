// Answer key cross-check: the ONE place the check status is decided.
// Kept byte-for-byte identical in two places (a vitest test compares them):
//   supabase/functions/analyze-paper/keyCheck.ts  (edge function, Deno)
//   src/lib/results/keyCheck.ts                   (browser)
// No imports, so it runs in both.

export type Answer = "A" | "B" | "C" | "D";
export type Letter = Answer;
export const KEY_ANSWERS: readonly Answer[] = ["A", "B", "C", "D"];

export type CheckStatus = "unchecked" | "confirmed" | "key_only" | "mismatch" | "mismatch_strong" | "resolved";
export const CHECK_STATUSES: readonly CheckStatus[] = [
  "unchecked", "confirmed", "key_only", "mismatch", "mismatch_strong", "resolved",
];

/** A recheck at or above this confidence that still disagrees with the key is a strong prompt. */
export const STRONG_CONFIDENCE = 0.9;

export interface KeyCheckFields {
  key_answer: string | null;
  ai_answer: string | null;
  recheck_answer?: string | null;
  recheck_confidence?: number | null;
  rechecked_at?: string | null;
  check_status?: string | null;
}

export const isAnswer = (v: unknown): v is Answer => typeof v === "string" && (KEY_ANSWERS as readonly string[]).includes(v);

const wasRechecked = (q: KeyCheckFields) => !!q.rechecked_at || isAnswer(q.recheck_answer);

/**
 * Status of one question. 'resolved' (a staff decision) is kept as it is; every
 * other status is worked out from the key, the AI's answer and the recheck.
 */
export function checkStatus(q: KeyCheckFields): CheckStatus {
  if (q.check_status === "resolved") return "resolved";
  const key = isAnswer(q.key_answer) ? q.key_answer : null;
  const ai = isAnswer(q.ai_answer) ? q.ai_answer : null;
  if (!key) return "unchecked";
  if (!ai) return "key_only";
  if (key === ai) return "confirmed";
  if (!wasRechecked(q)) return "mismatch";
  if (q.recheck_answer === key) return "confirmed";
  if (isAnswer(q.recheck_answer) && (q.recheck_confidence ?? 0) >= STRONG_CONFIDENCE) return "mismatch_strong";
  return "mismatch";
}

/** True when the key and the AI's first answer differ and the AI has not re-solved it yet. */
export function needsRecheck(q: KeyCheckFields): boolean {
  if (q.check_status === "resolved") return false;
  return isAnswer(q.key_answer) && isAnswer(q.ai_answer) && q.key_answer !== q.ai_answer && !wasRechecked(q);
}

/** Statuses that block "Mark as Ready". */
export const isBlockingStatus = (s: string | null | undefined): boolean => s === "mismatch" || s === "mismatch_strong";

/** Plain-English reasons the key check blocks "Mark as Ready". Empty when nothing blocks. */
export function keyCheckProblems(questions: (KeyCheckFields & { question_number: number })[]): string[] {
  const nums = questions
    .filter((q) => isBlockingStatus(checkStatus(q)))
    .map((q) => q.question_number)
    .sort((a, b) => a - b);
  if (nums.length === 0) return [];
  const label = nums.length === 1 ? `Question ${nums[0]} needs` : `Questions ${nums.join(", ")} need`;
  return [`${label} your decision: the answer key and the AI disagree`];
}

/** Short note shown under a question, or null. */
export function keyCheckNote(q: KeyCheckFields): string | null {
  const s = checkStatus(q);
  if (s === "confirmed" && isAnswer(q.ai_answer) && q.ai_answer !== q.key_answer && q.recheck_answer === q.key_answer) {
    return "AI rechecked: key is right";
  }
  if (s === "mismatch" && needsRecheck(q)) return "Waiting for the AI to recheck this question";
  if (s === "mismatch" && wasRechecked(q) && !isAnswer(q.recheck_answer)) {
    return "AI rechecked but could not find an answer";
  }
  return null;
}

export interface WriteFields {
  correct_answer: Answer | null;
  check_status: CheckStatus;
}

/**
 * What the first AI pass writes for one question. The key (or a staff decision) wins:
 * correct_answer only follows the AI when there is no key and nothing was resolved.
 */
export function firstPassWrite(
  existing: (Omit<KeyCheckFields, "ai_answer"> & { correct_answer: string | null }) | null,
  aiAnswer: Answer | null,
): WriteFields {
  const keep = !!existing && (isAnswer(existing.key_answer) || existing.check_status === "resolved");
  const correct = keep ? (isAnswer(existing!.correct_answer) ? existing!.correct_answer : null) : aiAnswer;
  return { correct_answer: correct, check_status: checkStatus({ ...(existing ?? { key_answer: null }), ai_answer: aiAnswer }) };
}

export interface KeyUploadPatch extends WriteFields {
  key_answer: Answer | null;
  is_grace: boolean;
}

/**
 * Saving an answer key for one question. The key becomes the answer used for scoring,
 * unless staff already resolved this question against the SAME key value (a different
 * key value undoes that decision, including a grace it set). Clearing the key (null)
 * leaves correct_answer alone. is_grace is always returned so every saved row carries
 * the same columns.
 */
export function keyUploadPatch(
  q: KeyCheckFields & { correct_answer: string | null; is_grace: boolean },
  key: Answer | null,
): KeyUploadPatch {
  const resolved = q.check_status === "resolved";
  const keepDecision = resolved && key !== null && key === q.key_answer;
  const current = isAnswer(q.correct_answer) ? q.correct_answer : null;
  const grace = q.is_grace === true;
  if (keepDecision) return { key_answer: key, correct_answer: current, is_grace: grace, check_status: "resolved" };
  const next = { ...q, key_answer: key, check_status: null };
  return {
    key_answer: key,
    correct_answer: key ?? current,
    // An undone decision takes its grace with it; a grace set without a decision stays.
    is_grace: resolved ? false : grace,
    check_status: checkStatus(next),
  };
}

export type Decision = "keep_key" | "use_ai" | "grace";

export interface ResolvePatch {
  correct_answer: Answer | null;
  is_grace: boolean;
  check_status: "resolved";
  human_edited: true;
}

/**
 * A staff decision on a disagreement. "Use AI's answer" takes the recheck answer when
 * there is one (it is the more careful solve), else the first answer. Grace keeps the key
 * as the answer and gives everyone the mark.
 */
export function resolvePatch(q: KeyCheckFields, decision: Decision): ResolvePatch {
  const key = isAnswer(q.key_answer) ? q.key_answer : null;
  const ai = isAnswer(q.recheck_answer) ? q.recheck_answer : isAnswer(q.ai_answer) ? q.ai_answer : null;
  const correct = decision === "use_ai" ? ai : key;
  return { correct_answer: correct, is_grace: decision === "grace", check_status: "resolved", human_edited: true };
}
