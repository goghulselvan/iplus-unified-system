/**
 * The letters that earn the mark on a question: the answer, plus any "also correct"
 * letters (e.g. both "which" and "that" fit the blank). Matches results_answer_ok in
 * the database.
 */
export interface AcceptedFields { correct_answer: string | null; also_correct?: string | null }

export const acceptedLetters = (q: AcceptedFields | undefined | null): string =>
  q?.correct_answer ? q.correct_answer + (q.also_correct ?? "") : "";

/** True when a student's answer earns the mark. Blank and "M" (two shaded) never do. */
export const answerOk = (answer: string | null | undefined, q: AcceptedFields | undefined | null): boolean =>
  !!answer && /^[ABCD]$/.test(answer) && acceptedLetters(q).includes(answer);

/** "B", or "B or A" when more than one letter is accepted. */
export const acceptedLabel = (q: AcceptedFields | undefined | null): string =>
  acceptedLetters(q).split("").join(" or ");
