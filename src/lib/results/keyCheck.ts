import type { CheckStatus, KeyFields } from "./questionRow";

/** How sure the AI must be, on a recheck, before a disagreement is a strong one. */
export const STRONG_CONFIDENCE = 0.9;

type Input = Partial<Pick<KeyFields,
  "key_answer" | "ai_answer" | "recheck_answer" | "recheck_confidence" | "rechecked_at" | "check_status">>;

/**
 * Status of one question from its key, the AI's answer and the AI's recheck.
 * A person's decision ("resolved") always stands.
 */
export function checkStatus(q: Input): CheckStatus {
  if (q.check_status === "resolved") return "resolved";
  if (!q.key_answer) return "unchecked";
  if (!q.ai_answer) return "key_only";
  if (q.key_answer === q.ai_answer) return "confirmed";
  if (!q.recheck_answer) return "mismatch"; // recheck still needed or the AI could not solve it
  if (q.recheck_answer === q.key_answer) return "confirmed";
  return Number(q.recheck_confidence ?? 0) >= STRONG_CONFIDENCE ? "mismatch_strong" : "mismatch";
}
