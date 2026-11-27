import { describe, expect, it } from "vitest";
import { parseKeyCsv, keyTemplateCsv } from "../answerKeyCsv";
import { cropRect } from "../keyCrop";
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

describe("planKeySave", () => {
  const qs = [
    { question_number: 1, correct_answer: "A", ai_answer: "A", key_answer: null, check_status: "unchecked" },
    { question_number: 2, correct_answer: "C", ai_answer: "C", key_answer: "C", check_status: "confirmed" },
    { question_number: 3, correct_answer: "D", ai_answer: "D", key_answer: "A", check_status: "resolved" },
    { question_number: 4, correct_answer: "B", ai_answer: "B", key_answer: null, check_status: "unchecked" },
    { question_number: 5, correct_answer: "B", ai_answer: "B", key_answer: "B", check_status: "resolved" },
  ] as unknown as Parameters<typeof planKeySave>[0];
  it("lets the key win except where a person already decided, and queues mismatches", () => {
    const p = planKeySave(qs, { 1: "A", 2: "C", 3: "A", 4: "D", 5: "B", 7: "C", 9: "A" }, 8);
    expect(p.rows.map((r) => [r.question_number, r.correct_answer, r.check_status])).toEqual([
      [1, "A", "confirmed"], [4, "D", "mismatch"], [7, "C", "key_only"],
    ]);
    expect(p.toRecheck).toEqual([4]);
    expect(p.unmatched).toEqual([9]);
    expect(p.unchanged).toBe(3); // same key as before: Q2, Q3 (decision stands) and Q5
  });
});

describe("planKeySave before the AI has read the paper", () => {
  it("saves the key on every question so the AI can cross-check it later", () => {
    const p = planKeySave([], { 1: "B", 2: "D", 3: "A" }, 3);
    expect(p.rows).toEqual([
      { question_number: 1, key_answer: "B", correct_answer: "B", is_grace: false, check_status: "key_only" },
      { question_number: 2, key_answer: "D", correct_answer: "D", is_grace: false, check_status: "key_only" },
      { question_number: 3, key_answer: "A", correct_answer: "A", is_grace: false, check_status: "key_only" },
    ]);
    expect(p.toRecheck).toEqual([]);
    expect(p.unmatched).toEqual([]);
  });
});

describe("planKeySave grace", () => {
  it("carries is_grace on every row and drops a grace when a different key undoes the decision", () => {
    const qs = [
      { question_number: 1, correct_answer: null, is_grace: true, key_answer: "B", ai_answer: "B", check_status: "resolved" },
      { question_number: 2, correct_answer: "A", is_grace: false, key_answer: "A", ai_answer: "A", check_status: "confirmed" },
    ] as unknown as Parameters<typeof planKeySave>[0];
    const p = planKeySave(qs, { 1: "C", 2: "D" }, 2);
    expect(p.rows.map((r) => r.is_grace)).toEqual([false, false]);
  });
});

describe("recheckInChunks", () => {
  it("sends chunks of 2 and reports progress", async () => {
    const calls: number[][] = [];
    const seen: string[] = [];
    const nums = Array.from({ length: 45 }, (_, i) => i + 1);
    const nums12 = nums.slice(0, 12);
    const done = await recheckInChunks("p", nums12, (d, t) => seen.push(`${d}/${t}`), () => false, undefined,
      async (_p, part) => { calls.push(part); return { rechecked_at: "", results: [] }; });
    expect(calls.map((c) => c.length)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(done).toBe(12);
    expect(seen).toEqual(["0/12", "2/12", "4/12", "6/12", "8/12", "10/12", "12/12"]);
  });
});

describe("Ready gate", () => {
  it("names the unresolved mismatch questions", () => {
    const row = (n: number, over: object) => ({ question_number: n, correct_answer: "A", is_grace: false, skill_category: "x", key_answer: "A", ai_answer: "A", ...over });
    const rows = [row(1, {}), row(2, { ai_answer: "D" }), row(3, { ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.95, rechecked_at: "t" }),
      row(4, { ai_answer: "D", check_status: "resolved" })] as unknown as Parameters<typeof readinessProblems>[0];
    expect(readinessProblems(rows, 4)).toEqual([
      "Questions 2, 3 need your decision: the answer key and the AI disagree",
    ]);
  });
});
