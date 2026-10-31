import { describe, it, expect } from "vitest";
import { olympiadsForClass, classGroup, readinessProblems, copyPlan, draftReason } from "../paperRules";

const full = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    question_number: i + 1,
    correct_answer: "A" as string | null,
    is_grace: false,
    skill_category: "Reasoning" as string | null,
  }));

describe("olympiadsForClass", () => {
  it("gives Kids only for LKG/UKG", () => {
    expect(olympiadsForClass("14")).toEqual(["KidsPO"]);
    expect(olympiadsForClass("15")).toEqual(["KidsPO"]);
  });
  it("gives the five subject olympiads for class 2", () => {
    expect(olympiadsForClass("02")).toEqual(["EPO", "MPO", "SPO", "GKSSPO", "LRPO"]);
  });
});

describe("classGroup", () => {
  it("maps classes", () => {
    expect(classGroup("14")).toBe("lkg_ukg");
    expect(classGroup("01")).toBe("class_1_2");
    expect(classGroup("05")).toBe("class_3_5");
    expect(classGroup("08")).toBe("class_6_8");
  });
});

describe("readinessProblems", () => {
  it("is empty when complete", () => expect(readinessProblems(full(50), 50)).toEqual([]));
  it("names a question with no answer", () => {
    const q = full(50);
    q[3].correct_answer = null;
    expect(readinessProblems(q, 50)).toEqual(["Questions 4 have no answer and are not marked as grace"]);
  });
  it("accepts grace with no answer", () => {
    const q = full(50);
    q[3].correct_answer = null;
    q[3].is_grace = true;
    expect(readinessProblems(q, 50)).toEqual([]);
  });
  it("reports missing rows", () => {
    expect(readinessProblems(full(48), 50)).toEqual(["Only 48 of 50 questions are entered"]);
  });
  it("names a missing skill", () => {
    const q = full(50);
    q[8].skill_category = null;
    expect(readinessProblems(q, 50)).toEqual(["Questions 9 have no skill"]);
  });
});

describe("copyPlan", () => {
  it("refuses to overwrite without replace", () => {
    expect(() => copyPlan({ questionCount: 50 }, { questionCount: 10 }, false)).toThrow("Slot 2 paper already has questions");
  });
  it("allows replace and empty targets", () => {
    expect(copyPlan({ questionCount: 50 }, { questionCount: 10 }, true).replaceExisting).toBe(true);
    expect(copyPlan({ questionCount: 50 }, { questionCount: 0 }, false).replaceExisting).toBe(false);
  });
  it("refuses an empty source", () => {
    expect(() => copyPlan({ questionCount: 0 }, { questionCount: 0 }, false)).toThrow();
  });
});

describe("draftReason", () => {
  it("is null when still ready", () => expect(draftReason(full(50), 50)).toBeNull());
  it("names the questions that need an answer", () => {
    const q = full(50);
    q[3].correct_answer = null;
    q[16].correct_answer = null;
    expect(draftReason(q, 50)).toBe("questions 4, 17 need an answer");
  });
});
