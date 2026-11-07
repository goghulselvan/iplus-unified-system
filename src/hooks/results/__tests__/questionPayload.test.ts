import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { questionPayload, type EditableQuestion } from "../usePapers";

describe("questionPayload", () => {
  it("gives a decision and a plain edit the same keys, so neither is sent as NULL", () => {
    const rows: EditableQuestion[] = [
      { question_number: 4, correct_answer: "B", is_grace: false, skill_category: "Logic", cognitive_level: "Apply", check_status: "resolved" },
      { question_number: 9, correct_answer: "C", is_grace: false, skill_category: "Number sense", cognitive_level: "Recall", check_status: "confirmed" },
    ];
    const p = questionPayload("paper1", rows);
    expect(Object.keys(p[0]).sort()).toEqual(Object.keys(p[1]).sort());
    expect(p.map((r) => r.check_status)).toEqual(["resolved", "confirmed"]);
    expect(p.every((r) => r.check_status != null)).toBe(true);
  });

  it("clears the answer for a grace question", () => {
    const [r] = questionPayload("p", [{ question_number: 1, correct_answer: "A", is_grace: true, skill_category: null, cognitive_level: null, check_status: "resolved" }]);
    expect(r.correct_answer).toBeNull();
  });
});
