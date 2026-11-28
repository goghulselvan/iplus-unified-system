import { describe, expect, it } from "vitest";
import { acceptedLabel, answerOk } from "../accepted";
import { omrCounts } from "../omrCounts";

describe("answerOk", () => {
  const q = { correct_answer: "B", also_correct: "A" };
  it("accepts the answer and an also-correct letter", () => {
    expect(answerOk("B", q)).toBe(true);
    expect(answerOk("A", q)).toBe(true);
  });
  it("rejects other letters, blank and two-shaded", () => {
    expect(answerOk("C", q)).toBe(false);
    expect(answerOk(null, q)).toBe(false);
    expect(answerOk("", q)).toBe(false);
    expect(answerOk("M", q)).toBe(false);
  });
  it("accepts nothing when the question has no answer", () => {
    expect(answerOk("A", { correct_answer: null, also_correct: "A" })).toBe(false);
  });
});

describe("acceptedLabel", () => {
  it("shows one letter, or both joined with 'or'", () => {
    expect(acceptedLabel({ correct_answer: "B" })).toBe("B");
    expect(acceptedLabel({ correct_answer: "B", also_correct: "A" })).toBe("B or A");
  });
});

describe("omrCounts with an also-correct letter", () => {
  it("counts either accepted letter as correct", () => {
    const qs = [{ question_number: 1, correct_answer: "B", also_correct: "A", is_grace: false }];
    expect(omrCounts(["A"], qs, 1)).toEqual({ correct: 1, wrong: 0, unanswered: 0 });
    expect(omrCounts(["B"], qs, 1)).toEqual({ correct: 1, wrong: 0, unanswered: 0 });
    expect(omrCounts(["C"], qs, 1)).toEqual({ correct: 0, wrong: 1, unanswered: 0 });
  });
});
