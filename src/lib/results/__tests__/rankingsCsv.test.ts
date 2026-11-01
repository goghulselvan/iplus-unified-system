import { describe, it, expect } from "vitest";
import { rankListCsv, coverageCsv, RANK_CSV_HEADER } from "../rankingsCsv";

const row = {
  rank_national: 1, rank_state: 1, rank_district: 2, rank_school: 1, student_name: "Asha K",
  registration_number: "233010301001", school_name: "St. Mary, Matha School", district_name: "Chennai",
  state_name: "Tamil Nadu", total: 48, max_marks: 50, percentage: 96, grade: "A++",
};

describe("rankListCsv", () => {
  it("starts with the header", () => {
    const lines = rankListCsv([row]).split("\r\n");
    expect(lines[0]).toBe(RANK_CSV_HEADER.join(","));
    expect(lines[0]).toContain("All-India rank");
  });
  it("quotes school names with commas and doubles quotes", () => {
    const csv = rankListCsv([row, { ...row, school_name: 'The "Best" School' }]);
    expect(csv).toContain('"St. Mary, Matha School"');
    expect(csv).toContain('"The ""Best"" School"');
  });
  it("writes the registration number with hyphens so Excel keeps it as text", () => {
    expect(rankListCsv([row])).toContain("2-33-01-03-01-001");
  });
  it("neutralises formula-looking text", () => {
    expect(rankListCsv([{ ...row, student_name: "=SUM(A1)" }])).toContain("'=SUM(A1)");
  });
  it("leaves blank ranks empty", () => {
    expect(rankListCsv([{ ...row, rank_state: null }]).split("\r\n")[1].startsWith("1,,2,1,")).toBe(true);
  });
});

describe("coverageCsv", () => {
  it("writes a header and quotes commas", () => {
    const csv = coverageCsv([{ school_name: "A, B", state_name: "TN", class_name: "Class 3", olympiad_name: "Maths", enrolled: 5, evaluated: 3, absent: 1, pending: 1 }]);
    expect(csv.split("\r\n")[0]).toBe("School,State,Class,Olympiad,Registered,Evaluated,Absent,Pending");
    expect(csv).toContain('"A, B",TN,Class 3,Maths,5,3,1,1');
  });
});
