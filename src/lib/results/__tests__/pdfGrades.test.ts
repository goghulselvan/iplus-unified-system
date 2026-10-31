import { describe, it, expect } from "vitest";
import { studentGrade, schoolGrade } from "../pdf/common";

// Pins band edges; reconcile with grading.ts at merge (TODO).
describe("grade bands", () => {
  it("student", () => {
    const g = (p: number) => studentGrade(p).grade;
    expect([g(95), g(94.9), g(90), g(80), g(70), g(60), g(50), g(49.9)]).toEqual(["A++", "A+", "A+", "A", "B+", "B", "C", "D"]);
  });
  it("school", () => {
    const g = (p: number) => schoolGrade(p).grade;
    expect([g(80), g(79.9), g(60), g(40), g(39.9)]).toEqual(["A", "B", "B", "C", "D"]);
  });
});
