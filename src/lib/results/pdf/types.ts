export interface RankOf { rank: number | null; of: number | null }

export interface StudentBlock {
  name: string;
  /** Formatted, e.g. 2-33-03-06-01-020 */
  regNo: string;
  className: string;
  olympiad: string;
  schoolName: string;
  /** e.g. "Slot 1 - 13 Oct 2026" */
  examLabel?: string;
}

export interface ScoreSheetInput {
  student: StudentBlock;
  score: {
    total: number;
    max: number;
    percentage: number;
    grade?: string;
    gradeLabel?: string;
    ranks: { school: RankOf; district: RankOf; state: RankOf; allIndia: RankOf };
  };
  questions: {
    number: number;
    /** Student's answer or mark; null/empty = not attempted */
    studentAnswer: string | null;
    /** Correct answer, or "Grace" */
    correctAnswer: string;
    result: "✓" | "✗" | "½";
    skill: string;
  }[];
}

export interface SkillReportInput {
  student: StudentBlock;
  skills: { skill: string; correct: number; total: number; percentage: number }[];
  /** Only drawn when provided; nothing is invented otherwise. */
  feedback?: {
    overall: string;
    strengths: { skill: string; feedback: string }[];
    focus_areas: { skill: string; feedback: string }[];
    tips: string[];
    goals: string[];
  } | null;
}

export interface SchoolSummaryInput {
  school: { name: string; city?: string; district?: string; state?: string; ssNo?: string };
  tiles: {
    enrolled: number;
    evaluated: number;
    absent: number;
    averagePct: number;
    schoolGrade?: string;
    schoolGradeLabel?: string;
    stateAveragePct: number | null;
  };
  rows: {
    className: string;
    olympiad: string;
    enrolled: number;
    evaluated: number;
    averagePct: number;
    stateAveragePct: number | null;
  }[];
  aiAnalysis?: string | null;
}

/** Rows must already be in rank order: the caller sorts. */
export interface SchoolRankingInput {
  school: { name: string };
  rows: {
    name: string;
    regNo: string;
    className: string;
    olympiad: string;
    score: string; // e.g. "42 / 50"
    percentage: number;
    grade: string;
    schoolRank: number | null;
    districtRank: number | null;
    stateRank: number | null;
    allIndiaRank: number | null;
  }[];
}

export interface AwardLetterInput {
  /** Letter date; defaults to today (pass for deterministic output) */
  date?: Date;
  school: { name: string; city?: string; principal?: string };
  awardees: { name: string; className: string; olympiad: string; award: string }[];
}
