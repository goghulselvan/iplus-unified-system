import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  checkStatus, firstPassWrite, keyCheckNote, keyCheckProblems, keyUploadPatch, needsRecheck, resolvePatch,
} from "../keyCheck";

const q = (o: Record<string, unknown> = {}) => ({
  key_answer: null, ai_answer: null, recheck_answer: null, recheck_confidence: null, rechecked_at: null,
  check_status: "unchecked", correct_answer: null, is_grace: false, ...o,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;
const T = "2026-11-07T10:00:00Z";
const expect_eq = (a: unknown, b: unknown) => expect(a).toEqual(b);
const expect_ok = (v: unknown) => expect(v).toBe(true);

describe("keyCheck copies", () => {
  it("src and the edge function copy are identical", () => {
    const root = path.resolve(__dirname, "../../../..");
    const web = fs.readFileSync(path.join(root, "src/lib/results/keyCheck.ts"), "utf8");
    const deno = fs.readFileSync(path.join(root, "supabase/functions/analyze-paper/keyCheck.ts"), "utf8");
    expect(web).toBe(deno);
  });
});

it("checkStatus: every rule in the spec", () => {
  expect_eq(checkStatus(q({ ai_answer: "B" })), "unchecked");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "B" })), "confirmed");
  expect_eq(checkStatus(q({ key_answer: "B" })), "key_only");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D" })), "mismatch");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "B", recheck_confidence: 0.6, rechecked_at: T })), "confirmed");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.9, rechecked_at: T })), "mismatch_strong");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.89, rechecked_at: T })), "mismatch");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "C", recheck_confidence: 0.95, rechecked_at: T })), "mismatch_strong");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: null, recheck_confidence: 0, rechecked_at: T })), "mismatch");
  expect_eq(checkStatus(q({ key_answer: "B", ai_answer: "D", check_status: "resolved" })), "resolved");
  expect_eq(checkStatus(q({ key_answer: "X", ai_answer: "D" })), "unchecked");
});

it("needsRecheck only for an un-rechecked disagreement", () => {
  expect_ok(needsRecheck(q({ key_answer: "B", ai_answer: "D" })));
  expect_ok(!needsRecheck(q({ key_answer: "B", ai_answer: "B" })));
  expect_ok(!needsRecheck(q({ key_answer: "B" })));
  expect_ok(!needsRecheck(q({ key_answer: "B", ai_answer: "D", rechecked_at: T })));
  expect_ok(!needsRecheck(q({ key_answer: "B", ai_answer: "D", check_status: "resolved" })));
});

it("keyCheckProblems names the questions", () => {
  expect_eq(keyCheckProblems([{ question_number: 1, ...q({ key_answer: "A", ai_answer: "A" }) }]), []);
  expect_eq(
    keyCheckProblems([
      { question_number: 9, ...q({ key_answer: "A", ai_answer: "B" }) },
      { question_number: 4, ...q({ key_answer: "A", ai_answer: "C", recheck_answer: "C", recheck_confidence: 0.95, rechecked_at: T }) },
      { question_number: 5, ...q({ key_answer: "A", ai_answer: "C", check_status: "resolved" }) },
    ]),
    ["Questions 4, 9 need your decision: the answer key and the AI disagree"],
  );
  expect_eq(keyCheckProblems([{ question_number: 7, ...q({ key_answer: "A", ai_answer: "B" }) }]),
    ["Question 7 needs your decision: the answer key and the AI disagree"]);
});

it("keyCheckNote", () => {
  expect_eq(keyCheckNote(q({ key_answer: "B", ai_answer: "D", recheck_answer: "B", rechecked_at: T })), "AI rechecked: key is right");
  expect_eq(keyCheckNote(q({ key_answer: "B", ai_answer: "D" })), "Waiting for the AI to recheck this question");
  expect_eq(keyCheckNote(q({ key_answer: "B", ai_answer: "B" })), null);
});

it("firstPassWrite: key and decisions win; the AI answer never becomes the marking key", () => {
  expect_eq(firstPassWrite(null, "C"), { correct_answer: null, check_status: "unchecked" });
  expect_eq(firstPassWrite(q({ correct_answer: "A" }), "C"), { correct_answer: null, check_status: "unchecked" });
  expect_eq(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), "C"), { correct_answer: "A", check_status: "mismatch" });
  expect_eq(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), "A"), { correct_answer: "A", check_status: "confirmed" });
  expect_eq(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), null), { correct_answer: "A", check_status: "key_only" });
  expect_eq(
    firstPassWrite(q({ key_answer: "A", correct_answer: "C", check_status: "resolved" }), "B"),
    { correct_answer: "C", check_status: "resolved" },
  );
});

it("keyUploadPatch: key becomes the answer unless resolved against the same key", () => {
  expect_eq(keyUploadPatch(q({ ai_answer: "B", correct_answer: "B" }), "B"), { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "confirmed" });
  expect_eq(keyUploadPatch(q({ ai_answer: "D", correct_answer: "D" }), "B"), { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "mismatch" });
  expect_eq(keyUploadPatch(q({ correct_answer: null }), "C"), { key_answer: "C", correct_answer: "C", is_grace: false, check_status: "key_only" });
  // resolved against the same key: decision kept
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "D", check_status: "resolved" }), "B"),
    { key_answer: "B", correct_answer: "D", is_grace: false, check_status: "resolved" },
  );
  // a different key value undoes the decision
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "D", check_status: "resolved" }), "D"),
    { key_answer: "D", correct_answer: "D", is_grace: false, check_status: "confirmed" },
  );
  // an earlier recheck still counts against a new key
  expect_eq(
    keyUploadPatch(q({ ai_answer: "D", recheck_answer: "B", recheck_confidence: 0.8, rechecked_at: T, correct_answer: "D" }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "confirmed" },
  );
  // a grace decision against the same key is kept, grace and all
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: true, check_status: "resolved" },
  );
  // a new key value undoes a grace decision: grace goes too
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "D"),
    { key_answer: "D", correct_answer: "D", is_grace: false, check_status: "confirmed" },
  );
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "C"),
    { key_answer: "C", correct_answer: "C", is_grace: false, check_status: "mismatch" },
  );
  // clearing the key also undoes a grace decision
  expect_eq(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), null),
    { key_answer: null, correct_answer: null, is_grace: false, check_status: "unchecked" },
  );
  // grace set by hand (no decision) is left alone
  expect_eq(
    keyUploadPatch(q({ ai_answer: "D", correct_answer: "D", is_grace: true }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: true, check_status: "mismatch" },
  );
  // clearing the key clears the marking answer: marking waits for a key
  expect_eq(keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B" }), null), { key_answer: null, correct_answer: null, is_grace: false, check_status: "unchecked" });
});

it("resolvePatch", () => {
  const m = q({ key_answer: "B", ai_answer: "D", recheck_answer: "C", rechecked_at: T });
  expect_eq(resolvePatch(m, "keep_key"), { correct_answer: "B", is_grace: false, check_status: "resolved", human_edited: true });
  expect_eq(resolvePatch(m, "use_ai"), { correct_answer: "C", is_grace: false, check_status: "resolved", human_edited: true });
  expect_eq(resolvePatch(q({ key_answer: "B", ai_answer: "D" }), "use_ai").correct_answer, "D");
  expect_eq(resolvePatch(m, "grace"), { correct_answer: "B", is_grace: true, check_status: "resolved", human_edited: true });
});
