/**
 * Correct / wrong / unanswered for one OMR sheet, scored the way the database scores it:
 * grace = correct, answer equal to the key = correct, blank = unanswered, anything else
 * (another letter, or 'M' for MULTIPLE) = wrong.
 */
export interface OmrCounts { correct: number; wrong: number; unanswered: number }

export function omrCounts(
  answers: (string | null)[],
  questions: { question_number: number; correct_answer: string | null; is_grace: boolean }[],
  total: number,
): OmrCounts {
  const byQ = new Map(questions.map((q) => [q.question_number, q]));
  const c: OmrCounts = { correct: 0, wrong: 0, unanswered: 0 };
  for (let n = 1; n <= total; n++) {
    const q = byQ.get(n);
    const a = answers[n - 1] ?? null;
    if (q?.is_grace || (a !== null && a === q?.correct_answer)) c.correct++;
    else if (a === null) c.unanswered++;
    else c.wrong++;
  }
  return c;
}

/** How a stored OMR answer is shown to staff. */
export const omrAnswerLabel = (a: string | null) => (a === null ? "Not answered" : a === "M" ? "MULTIPLE" : a);
