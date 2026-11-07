import { describe, expect, it } from "vitest";
import { parseKeyCsv, keyTemplateCsv } from "../answerKeyCsv";
import { cropRect } from "../keyCrop";
import { checkStatus } from "../keyCheck";
import { planKeySave } from "../keyPlan";
import { recheckInChunks } from "../keyApi";
import { readinessProblems } from "../paperRules";

describe("answer key CSV", () => {
  it("round-trips the template once answers are filled in", () => {
    const tpl = keyTemplateCsv(4);
    expect(tpl.split("\r\n")[0]).toBe("question_number,answer");
    const filled = tpl.replace("1,", "1,a").replace("2,", "2,B").replace("3,", "3,C").replace("4,", "4,D");
    const r = parseKeyCsv(filled, 4);
    expect(r.errors).toEqual([]);
    expect(r.answers).toEqual({ 1: "A", 2: "B", 3: "C", 4: "D" });
    expect(r.missing).toEqual([]);
  });
  it("names the row for a bad letter in plain English", () => {
    const r = parseKeyCsv("question_number,answer\n1,A\n2,E\n", 3);
    expect(r.errors).toEqual(['Row 3: "E" is not a valid answer for question 2. Use A, B, C or D.']);
    expect(r.missing).toEqual([2, 3]);
  });
  it("rejects questions outside the paper and repeats", () => {
    const r = parseKeyCsv("1,A\n9,B\n1,C", 3);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/question 9 is not in this paper/);
    expect(r.errors[1]).toMatch(/question 1 appears more than once/);
  });
  it("accepts a file with no header, a BOM and quotes", () => {
    const r = parseKeyCsv('﻿"1","a"\r\n2,b', 2);
    expect(r.errors).toEqual([]);
    expect(r.answers).toEqual({ 1: "A", 2: "B" });
  });
});

describe("crop math", () => {
  it("adds 3% padding on each side and converts to pixels", () => {
    expect(cropRect({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, 1000, 2000))
      .toEqual({ sx: 170, sy: 540, sw: 460, sh: 520 });
  });
  it("clamps to the page edges", () => {
    const r = cropRect({ x: 0, y: 0.9, w: 1, h: 0.1 }, 1000, 2000);
    expect(r).toEqual({ sx: 0, sy: 1740, sw: 1000, sh: 260 });
    expect(r.sy + r.sh).toBeLessThanOrEqual(2000);
  });
  it("never returns an empty rectangle", () => {
    const r = cropRect({ x: 1, y: 1, w: 0, h: 0 }, 100, 100, 0);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});

describe("checkStatus", () => {
  const base = { key_answer: "B", ai_answer: "B", recheck_answer: null, recheck_confidence: null, rechecked_at: null, check_status: "unchecked" } as const;
  it("follows the spec rules", () => {
    expect(checkStatus({ ...base, key_answer: null })).toBe("unchecked");
    expect(checkStatus({ ...base })).toBe("confirmed");
    expect(checkStatus({ ...base, ai_answer: null })).toBe("key_only");
    expect(checkStatus({ ...base, ai_answer: "D" })).toBe("mismatch");
    expect(checkStatus({ ...base, ai_answer: "D", recheck_answer: "B", recheck_confidence: 0.5 })).toBe("confirmed");
    expect(checkStatus({ ...base, ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.9 })).toBe("mismatch_strong");
    expect(checkStatus({ ...base, ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.89 })).toBe("mismatch");
    expect(checkStatus({ ...base, ai_answer: "D", check_status: "resolved" })).toBe("resolved");
  });
});

describe("planKeySave", () => {
  const qs = [
    { question_number: 1, correct_answer: "A", is_grace: false, ai_answer: "A", check_status: "unchecked" },
    { question_number: 2, correct_answer: "C", is_grace: false, ai_answer: "C", check_status: "unchecked" },
    { question_number: 3, correct_answer: "D", is_grace: false, ai_answer: "D", check_status: "resolved" },
  ] as unknown as Parameters<typeof planKeySave>[0];
  it("lets the key win except where a person already decided, and queues mismatches", () => {
    const p = planKeySave(qs, { 1: "A", 2: "B", 3: "A", 7: "C" });
    expect(p.rows.map((r) => [r.question_number, r.correct_answer, r.check_status])).toEqual([
      [1, "A", "confirmed"], [2, "B", "mismatch"], [3, "D", "resolved"],
    ]);
    expect(p.toRecheck).toEqual([2]);
    expect(p.unmatched).toEqual([7]);
  });
});

describe("recheckInChunks", () => {
  it("sends chunks of 20 and reports progress", async () => {
    const calls: number[][] = [];
    const seen: string[] = [];
    const nums = Array.from({ length: 45 }, (_, i) => i + 1);
    const done = await recheckInChunks("p", nums, (d, t) => seen.push(`${d}/${t}`), () => false, 20,
      async (_p, part) => { calls.push(part); return { rechecked: part.length, results: [] }; });
    expect(calls.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(done).toBe(45);
    expect(seen).toEqual(["0/45", "20/45", "40/45", "45/45"]);
  });
});

describe("Ready gate", () => {
  it("names the unresolved mismatch questions", () => {
    const rows = [1, 2, 3].map((n) => ({
      question_number: n, correct_answer: "A", is_grace: false, skill_category: "x",
      check_status: n === 2 ? "mismatch" : n === 3 ? "mismatch_strong" : "confirmed",
    })) as unknown as Parameters<typeof readinessProblems>[0];
    expect(readinessProblems(rows, 3)).toEqual([
      "Questions 2, 3 need your decision because the answer key and the AI disagree",
    ]);
  });
});
