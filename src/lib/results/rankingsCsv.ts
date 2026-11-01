export interface RankRowForCsv {
  rank_national: number | null;
  rank_state: number | null;
  rank_district: number | null;
  rank_school: number | null;
  student_name: string;
  registration_number: string;
  school_name: string | null;
  district_name: string | null;
  state_name: string | null;
  total: number;
  max_marks: number;
  percentage: number;
  grade: string;
}

export interface CoverageRowForCsv {
  school_name: string;
  state_name: string;
  class_name: string;
  olympiad_name: string;
  enrolled: number;
  evaluated: number;
  absent: number;
  pending: number;
}

import { formatReg } from "./regNumber";

/** Quote a cell when it holds a comma, quote or line break. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  // Stop spreadsheets running a name like "=SUM(..)" as a formula.
  if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

export const RANK_CSV_HEADER = [
  "All-India rank", "State rank", "District rank", "School rank", "Name",
  "Registration number", "School", "District", "State", "Score", "Out of", "Percentage", "Grade",
];

export function rankListCsv(rows: RankRowForCsv[]): string {
  return [
    line(RANK_CSV_HEADER),
    ...rows.map((r) =>
      line([
        r.rank_national, r.rank_state, r.rank_district, r.rank_school, r.student_name,
        formatReg(r.registration_number), r.school_name, r.district_name, r.state_name,
        r.total, r.max_marks, r.percentage, r.grade,
      ]),
    ),
  ].join("\r\n") + "\r\n";
}

export const COVERAGE_CSV_HEADER = [
  "School", "State", "Class", "Olympiad", "Registered", "Evaluated", "Absent", "Pending",
];

// TODO: replace the per-school calls behind this with the all-schools results_registered_vs_evaluated RPC when it lands.
export function coverageCsv(rows: CoverageRowForCsv[]): string {
  return [
    line(COVERAGE_CSV_HEADER),
    ...rows.map((r) =>
      line([r.school_name, r.state_name, r.class_name, r.olympiad_name, r.enrolled, r.evaluated, r.absent, r.pending]),
    ),
  ].join("\r\n") + "\r\n";
}

/** Save text as a file. UTF-8 BOM so Excel reads names correctly. */
export function downloadCsv(fileName: string, text: string) {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
