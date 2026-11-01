import { OLYMPIAD_NAMES, type OlympiadCode } from "./paperRules";

export const FLAG_TYPE_LABEL: Record<string, string> = {
  identical_answers: "Identical answer sheets",
  same_wrong_answers: "Same wrong answers",
  low_score_variance: "Scores almost the same",
  far_above_state: "Far above the state",
  adjacent_copying: "Neighbouring roll numbers match",
  answer_distribution_bias: "Same option marked again and again",
};
export const SEVERITY_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium" };
export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", investigating: "Investigating", verified: "Verified", dismissed: "Dismissed",
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export interface FlagTextInput {
  flag_type: string;
  details: Record<string, unknown>;
  class_code: string | null;
  olympiad_code: string | null;
}

/** One plain-English sentence for a flag. A flag never acts on its own; this only describes what the scan saw. */
export function flagExplanation(f: FlagTextInput, schoolName: string, className: (code: string) => string): string {
  const d = f.details ?? {};
  const where = [
    f.class_code ? className(f.class_code) : null,
    f.olympiad_code ? OLYMPIAD_NAMES[f.olympiad_code as OlympiadCode] ?? f.olympiad_code : null,
  ].filter(Boolean).join(" ");
  const at = `${where ? `in ${where} ` : ""}at ${schoolName || "this school"}`;
  switch (f.flag_type) {
    case "identical_answers":
      return `${num(d.studentCount)} students ${at} gave exactly the same answers on all ${num(d.questions)} questions.`;
    case "same_wrong_answers":
      return `${num(d.pairCount)} pair${num(d.pairCount) === 1 ? "" : "s"} of students ${at} chose the same wrong option on up to ${num(d.maxSharedPct)}% of their wrong answers.`;
    case "low_score_variance":
      return `${num(d.studentCount)} students ${at} scored almost the same marks (average ${num(d.meanPct)}%, spread only ${num(d.stdDev)} points). Real classes are usually much more spread out.`;
    case "far_above_state":
      return `Students ${at} averaged ${num(d.schoolAvgPct)}%, which is ${num(d.gap)} points above the ${num(d.stateAvgPct)}% average of other schools in the same state (${num(d.studentCount)} students here).`;
    case "adjacent_copying":
      return `${num(d.chainLength)} students ${at} with back-to-back registration numbers have at least ${num(d.minSimilarityPct)}% of their answers the same as the student next to them.`;
    case "answer_distribution_bias":
      return `${num(d.sharePct)}% of all answers from ${num(d.studentCount)} students ${at} were option ${String(d.letter ?? "?")}. In the answer key only ${num(d.keySharePct)}% of the answers are ${String(d.letter ?? "?")}.`;
    default:
      return `A pattern worth checking was found ${at}.`;
  }
}

/** Statuses a flag may move to next, in the order staff use them. */
export const NEXT_STATUSES = ["investigating", "verified", "dismissed", "pending"] as const;
export const NOTE_REQUIRED = new Set(["verified", "dismissed"]);
