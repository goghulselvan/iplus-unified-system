import { describe, it, expect } from "vitest";
import { RESULTS_NAV, CURRENT_RESULTS_PHASE } from "../nav";

describe("RESULTS_NAV", () => {
  it("has the 11 pages with the agreed labels", () => {
    expect(RESULTS_NAV.map((n) => n.label)).toEqual([
      "Results Dashboard",
      "Question Papers",
      "Upload Answers",
      "Students & Attendance",
      "Student Result",
      "Rankings",
      "Skill Analysis",
      "School Results",
      "Release & Send",
      "Integrity Checks",
      "Awards & Certificates",
    ]);
  });
  it("has unique paths all under /results", () => {
    const paths = RESULTS_NAV.map((n) => n.path);
    expect(new Set(paths).size).toBe(11);
    paths.forEach((p) => expect(p === "/results" || p.startsWith("/results/")).toBe(true));
  });
  it("only Student Result is hidden, and papers is live from phase 1", () => {
    expect(RESULTS_NAV.filter((n) => n.hidden).map((n) => n.key)).toEqual(["student"]);
    expect(CURRENT_RESULTS_PHASE).toBeGreaterThanOrEqual(1);
    expect(RESULTS_NAV.find((n) => n.key === "papers")!.phase).toBeLessThanOrEqual(CURRENT_RESULTS_PHASE);
  });
});
