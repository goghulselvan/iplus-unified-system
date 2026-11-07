import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkStatus, firstPassWrite, keyCheckNote, keyCheckProblems, keyUploadPatch, needsRecheck, resolvePatch,
} from "./keyCheck.ts";

const q = (o: Record<string, unknown> = {}) => ({
  key_answer: null, ai_answer: null, recheck_answer: null, recheck_confidence: null, rechecked_at: null,
  check_status: "unchecked", correct_answer: null, is_grace: false, ...o,
  // deno-lint-ignore no-explicit-any
}) as any;
const T = "2026-11-07T10:00:00Z";

Deno.test("checkStatus: every rule in the spec", () => {
  assertEquals(checkStatus(q({ ai_answer: "B" })), "unchecked");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "B" })), "confirmed");
  assertEquals(checkStatus(q({ key_answer: "B" })), "key_only");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D" })), "mismatch");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "B", recheck_confidence: 0.6, rechecked_at: T })), "confirmed");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.9, rechecked_at: T })), "mismatch_strong");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.89, rechecked_at: T })), "mismatch");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: "C", recheck_confidence: 0.95, rechecked_at: T })), "mismatch_strong");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", recheck_answer: null, recheck_confidence: 0, rechecked_at: T })), "mismatch");
  assertEquals(checkStatus(q({ key_answer: "B", ai_answer: "D", check_status: "resolved" })), "resolved");
  assertEquals(checkStatus(q({ key_answer: "X", ai_answer: "D" })), "unchecked");
});

Deno.test("needsRecheck only for an un-rechecked disagreement", () => {
  assert(needsRecheck(q({ key_answer: "B", ai_answer: "D" })));
  assert(!needsRecheck(q({ key_answer: "B", ai_answer: "B" })));
  assert(!needsRecheck(q({ key_answer: "B" })));
  assert(!needsRecheck(q({ key_answer: "B", ai_answer: "D", rechecked_at: T })));
  assert(!needsRecheck(q({ key_answer: "B", ai_answer: "D", check_status: "resolved" })));
});

Deno.test("keyCheckProblems names the questions", () => {
  assertEquals(keyCheckProblems([{ question_number: 1, ...q({ key_answer: "A", ai_answer: "A" }) }]), []);
  assertEquals(
    keyCheckProblems([
      { question_number: 9, ...q({ key_answer: "A", ai_answer: "B" }) },
      { question_number: 4, ...q({ key_answer: "A", ai_answer: "C", recheck_answer: "C", recheck_confidence: 0.95, rechecked_at: T }) },
      { question_number: 5, ...q({ key_answer: "A", ai_answer: "C", check_status: "resolved" }) },
    ]),
    ["Questions 4, 9 need your decision: the answer key and the AI disagree"],
  );
  assertEquals(keyCheckProblems([{ question_number: 7, ...q({ key_answer: "A", ai_answer: "B" }) }]),
    ["Question 7 needs your decision: the answer key and the AI disagree"]);
});

Deno.test("keyCheckNote", () => {
  assertEquals(keyCheckNote(q({ key_answer: "B", ai_answer: "D", recheck_answer: "B", rechecked_at: T })), "AI rechecked: key is right");
  assertEquals(keyCheckNote(q({ key_answer: "B", ai_answer: "D" })), "Waiting for the AI to recheck this question");
  assertEquals(keyCheckNote(q({ key_answer: "B", ai_answer: "B" })), null);
});

Deno.test("firstPassWrite: key and decisions win, otherwise the AI answer", () => {
  assertEquals(firstPassWrite(null, "C"), { correct_answer: "C", check_status: "unchecked" });
  assertEquals(firstPassWrite(q({ correct_answer: "A" }), "C"), { correct_answer: "C", check_status: "unchecked" });
  assertEquals(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), "C"), { correct_answer: "A", check_status: "mismatch" });
  assertEquals(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), "A"), { correct_answer: "A", check_status: "confirmed" });
  assertEquals(firstPassWrite(q({ key_answer: "A", correct_answer: "A" }), null), { correct_answer: "A", check_status: "key_only" });
  assertEquals(
    firstPassWrite(q({ key_answer: "A", correct_answer: "C", check_status: "resolved" }), "B"),
    { correct_answer: "C", check_status: "resolved" },
  );
});

Deno.test("keyUploadPatch: key becomes the answer unless resolved against the same key", () => {
  assertEquals(keyUploadPatch(q({ ai_answer: "B", correct_answer: "B" }), "B"), { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "confirmed" });
  assertEquals(keyUploadPatch(q({ ai_answer: "D", correct_answer: "D" }), "B"), { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "mismatch" });
  assertEquals(keyUploadPatch(q({ correct_answer: null }), "C"), { key_answer: "C", correct_answer: "C", is_grace: false, check_status: "key_only" });
  // resolved against the same key: decision kept
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "D", check_status: "resolved" }), "B"),
    { key_answer: "B", correct_answer: "D", is_grace: false, check_status: "resolved" },
  );
  // a different key value undoes the decision
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "D", check_status: "resolved" }), "D"),
    { key_answer: "D", correct_answer: "D", is_grace: false, check_status: "confirmed" },
  );
  // an earlier recheck still counts against a new key
  assertEquals(
    keyUploadPatch(q({ ai_answer: "D", recheck_answer: "B", recheck_confidence: 0.8, rechecked_at: T, correct_answer: "D" }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: false, check_status: "confirmed" },
  );
  // a grace decision against the same key is kept, grace and all
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: true, check_status: "resolved" },
  );
  // a new key value undoes a grace decision: grace goes too
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "D"),
    { key_answer: "D", correct_answer: "D", is_grace: false, check_status: "confirmed" },
  );
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), "C"),
    { key_answer: "C", correct_answer: "C", is_grace: false, check_status: "mismatch" },
  );
  // clearing the key also undoes a grace decision
  assertEquals(
    keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B", is_grace: true, check_status: "resolved" }), null),
    { key_answer: null, correct_answer: "B", is_grace: false, check_status: "unchecked" },
  );
  // grace set by hand (no decision) is left alone
  assertEquals(
    keyUploadPatch(q({ ai_answer: "D", correct_answer: "D", is_grace: true }), "B"),
    { key_answer: "B", correct_answer: "B", is_grace: true, check_status: "mismatch" },
  );
  // clearing the key leaves the answer alone
  assertEquals(keyUploadPatch(q({ key_answer: "B", ai_answer: "D", correct_answer: "B" }), null), { key_answer: null, correct_answer: "B", is_grace: false, check_status: "unchecked" });
});

Deno.test("resolvePatch", () => {
  const m = q({ key_answer: "B", ai_answer: "D", recheck_answer: "C", rechecked_at: T });
  assertEquals(resolvePatch(m, "keep_key"), { correct_answer: "B", is_grace: false, check_status: "resolved", human_edited: true });
  assertEquals(resolvePatch(m, "use_ai"), { correct_answer: "C", is_grace: false, check_status: "resolved", human_edited: true });
  assertEquals(resolvePatch(q({ key_answer: "B", ai_answer: "D" }), "use_ai").correct_answer, "D");
  assertEquals(resolvePatch(m, "grace"), { correct_answer: "B", is_grace: true, check_status: "resolved", human_edited: true });
});
