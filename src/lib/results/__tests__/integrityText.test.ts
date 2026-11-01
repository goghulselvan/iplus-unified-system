import { describe, it, expect } from "vitest";
import { flagExplanation } from "../integrityText";

const cn = (c: string) => `Class ${Number(c)}`;
describe("flagExplanation", () => {
  it("describes identical answers in plain English", () => {
    const t = flagExplanation({ flag_type: "identical_answers", class_code: "04", olympiad_code: "MPO", details: { studentCount: 5, questions: 40 } }, "ABC School", cn);
    expect(t).toBe("5 students in Class 4 Maths at ABC School gave exactly the same answers on all 40 questions.");
  });
  it("handles every type without leaking database words", () => {
    for (const ft of ["same_wrong_answers", "low_score_variance", "far_above_state", "adjacent_copying", "answer_distribution_bias", "unknown"]) {
      const t = flagExplanation({ flag_type: ft, class_code: null, olympiad_code: null, details: {} }, "X", cn);
      expect(t).not.toMatch(/_|undefined|NaN/);
    }
  });
});
