export interface ResultsNavItem {
  key: string;
  label: string;
  path: string;
  /** Build phase in which this page goes live. */
  phase: number;
  /** One plain-English sentence on what the page will do. */
  summary: string;
  /** Reached by clicking a student, so not shown in the sub-navigation. */
  hidden?: boolean;
}

export const CURRENT_RESULTS_PHASE = 1;

export const RESULTS_NAV: ResultsNavItem[] = [
  { key: "dashboard", label: "Results Dashboard", path: "/results", phase: 0, summary: "See how many papers are ready, how many students are evaluated and what is waiting for release." },
  { key: "papers", label: "Question Papers", path: "/results/papers", phase: 1, summary: "Upload each question paper, check the answers and skills, and mark it ready." },
  { key: "upload", label: "Upload Answers", path: "/results/upload", phase: 2, summary: "Upload students' answers from a CSV file, check them in plain English, then confirm." },
  { key: "students", label: "Students & Attendance", path: "/results/students", phase: 2, summary: "Find students, mark them absent or present in bulk, and undo deleted results." },
  { key: "student", label: "Student Result", path: "/results/student", phase: 3, hidden: true, summary: "See one student's score, grade, ranks and answer review, and download their reports." },
  { key: "rankings", label: "Rankings", path: "/results/rankings", phase: 3, summary: "See ranks for each class and olympiad at school, district, state and all-India level." },
  { key: "skills", label: "Skill Analysis", path: "/results/skills", phase: 4, summary: "Generate skill analysis for all schools and watch its progress." },
  { key: "schools", label: "School Results", path: "/results/schools", phase: 3, summary: "See every school's average, how it compares with the state, and its release status." },
  { key: "release", label: "Release & Send", path: "/results/release", phase: 5, summary: "Approve results for release and send them to schools by email and WhatsApp." },
  { key: "integrity", label: "Integrity Checks", path: "/results/integrity", phase: 6, summary: "Scan for suspicious answer patterns and review each flag." },
  { key: "awards", label: "Awards & Certificates", path: "/results/awards", phase: 7, summary: "Allot awards, print award letters and prepare courier packs." },
];

export const isNavLive = (item: ResultsNavItem, current = CURRENT_RESULTS_PHASE) =>
  item.phase <= current;
