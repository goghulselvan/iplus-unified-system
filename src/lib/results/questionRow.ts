/**
 * Columns added by the answer-key cross-check migration. The generated database
 * types are not regenerated yet, so the question row is extended here, in ONE place.
 */
export type Letter = "A" | "B" | "C" | "D";

export type CheckStatus =
  | "unchecked"
  | "confirmed"
  | "key_only"
  | "mismatch"
  | "mismatch_strong"
  | "resolved";

/** Fractions (0 to 1) of the page, measured from the top-left corner. */
export interface FigureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KeyFields {
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  key_answer: Letter | null;
  ai_answer: Letter | null;
  ai_reason: string | null;
  recheck_answer: Letter | null;
  recheck_confidence: number | string | null;
  recheck_reason: string | null;
  rechecked_at: string | null;
  figure_page: number | null;
  figure_box: FigureBox | null;
  check_status: CheckStatus;
}

export const LETTERS: readonly Letter[] = ["A", "B", "C", "D"];
export const isLetter = (v: unknown): v is Letter => v === "A" || v === "B" || v === "C" || v === "D";
