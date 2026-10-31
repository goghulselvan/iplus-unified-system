import type { Tables } from "@/integrations/supabase/types";

export type OlympiadCode = "EPO" | "MPO" | "SPO" | "GKSSPO" | "LRPO" | "KidsPO";
export type ClassGroup = "lkg_ukg" | "class_1_2" | "class_3_5" | "class_6_8";
export type QuestionRow = Tables<"questions">;

export const OLYMPIAD_NAMES: Record<OlympiadCode, string> = {
  EPO: "English",
  MPO: "Maths",
  SPO: "Science",
  GKSSPO: "GK & Social Studies",
  LRPO: "Logical Reasoning",
  KidsPO: "Kids",
};

export const COGNITIVE_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"] as const;
export const ANSWERS = ["A", "B", "C", "D"] as const;

const SCHOOL_OLYMPIADS: OlympiadCode[] = ["EPO", "MPO", "SPO", "GKSSPO", "LRPO"];

export const isKidsClass = (classCode: string) => classCode === "14" || classCode === "15";

export function olympiadsForClass(classCode: string): OlympiadCode[] {
  return isKidsClass(classCode) ? ["KidsPO"] : [...SCHOOL_OLYMPIADS];
}

export function classGroup(classCode: string): ClassGroup {
  if (isKidsClass(classCode)) return "lkg_ukg";
  const n = parseInt(classCode, 10);
  if (n <= 2) return "class_1_2";
  if (n <= 5) return "class_3_5";
  return "class_6_8";
}

/** Class codes in display order: LKG, UKG, 1..8. */
export const CLASS_ORDER = ["14", "15", "01", "02", "03", "04", "05", "06", "07", "08"];

const list = (nums: number[]) => nums.join(", ");

type ReadinessRow = Pick<QuestionRow, "question_number" | "correct_answer" | "is_grace" | "skill_category">;

/** Plain-English reasons a paper cannot be marked Ready. Empty when it is ready. */
export function readinessProblems(questions: ReadinessRow[], total: number): string[] {
  const problems: string[] = [];
  if (questions.length < total) {
    problems.push(`Only ${questions.length} of ${total} questions are entered`);
  }
  const sorted = [...questions].sort((a, b) => a.question_number - b.question_number);
  const noAnswer = sorted.filter((q) => !q.is_grace && !q.correct_answer).map((q) => q.question_number);
  if (noAnswer.length) {
    problems.push(`Questions ${list(noAnswer)} have no answer and are not marked as grace`);
  }
  const noSkill = sorted.filter((q) => !q.skill_category || !q.skill_category.trim()).map((q) => q.question_number);
  if (noSkill.length) {
    problems.push(`Questions ${list(noSkill)} have no skill`);
  }
  return problems;
}

export interface CopyPlan {
  /** Whether existing questions on the target must be removed first. */
  replaceExisting: boolean;
  count: number;
}

/** Decide whether copying a paper's questions is allowed. Throws a plain-English message when not. */
export function copyPlan(
  source: { questionCount: number },
  target: { questionCount: number },
  replace: boolean,
  targetLabel = "Slot 2",
): CopyPlan {
  if (source.questionCount === 0) throw new Error("There are no questions to copy yet");
  if (target.questionCount > 0 && !replace) {
    throw new Error(`${targetLabel} paper already has questions`);
  }
  return { replaceExisting: target.questionCount > 0, count: source.questionCount };
}
