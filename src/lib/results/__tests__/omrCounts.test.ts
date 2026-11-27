import { describe, expect, it } from "vitest";
import { omrAnswerLabel, omrCounts } from "../omrCounts";

const q = (n: number, key: string | null, grace = false) => ({ question_number: n, correct_answer: key, is_grace: grace });

describe("omrCounts", () => {
  it("counts MULTIPLE as wrong and blank as unanswered", () => {
    expect(omrCounts(["A", "M", null, "C"], [q(1, "A"), q(2, "B"), q(3, "C"), q(4, "D")], 4))
      .toEqual({ correct: 1, wrong: 2, unanswered: 1 });
  });
  it("counts a grace question as correct even when left blank", () => {
    expect(omrCounts([null, "B"], [q(1, null, true), q(2, "B")], 2)).toEqual({ correct: 2, wrong: 0, unanswered: 0 });
  });
  it("only counts the paper's questions", () => {
    expect(omrCounts(["A", "B", "C"], [q(1, "A"), q(2, "B")], 2)).toEqual({ correct: 2, wrong: 0, unanswered: 0 });
  });
});

describe("omrAnswerLabel", () => {
  it("spells out MULTIPLE and blanks", () => {
    expect(omrAnswerLabel("M")).toBe("MULTIPLE");
    expect(omrAnswerLabel(null)).toBe("Not answered");
    expect(omrAnswerLabel("B")).toBe("B");
  });
});
