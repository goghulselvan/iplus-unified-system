import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  batchPercent, buildBatchRequest, buildFeedbackSchema, buildSchoolRequest, chunk, parseResultLine,
  groupBulkRows, packCustomId, unpackCustomId, readLines, stripName, SCHOOL_SCHEMA, validateFeedback,
} from "./prompt.ts";

const input = {
  enrollmentId: "11111111-2222-3333-4444-555555555555", basisHash: "0123456789abcdef0123456789abcdef",
  classCode: "04", olympiadCode: "MPO", grade: "B+",
  skills: [{ skill: "Fractions", correct: 3, total: 4 }, { skill: "Geometry", correct: 1.5, total: 3 }],
};

Deno.test("request has only class, olympiad, grade label and skill counts", () => {
  const req = buildBatchRequest({
    ...input,
    // extra identifying fields smuggled in must not appear
    ...({ studentName: "Arun Kumar", registrationNumber: "123456789012", schoolName: "Greenfield School" } as object),
  });
  const s = JSON.stringify(req);
  for (const bad of ["Arun", "Kumar", "123456789012", "Greenfield", "student_name", "registrationNumber", "schoolName"]) {
    assertFalse(s.toLowerCase().includes(bad.toLowerCase()), bad);
  }
  assertEquals(req.custom_id, "11111111222233334444555555555555" + "0123456789abcdef0123456789abcdef");
  assertEquals(req.custom_id.length, 64);
  assertEquals(unpackCustomId(req.custom_id), { enrollmentId: input.enrollmentId, basisHash: input.basisHash });
  const p = req.params as Record<string, any>;
  assertEquals(p.model, "claude-haiku-5-5");
  assertEquals(p.max_tokens, 2000);
  assertEquals(p.system[0].cache_control, { type: "ephemeral" });
  assertEquals(p.messages[0].content, "Class: Class 4\nOlympiad: Maths\nPerformance level: Strong Foundation\nSkills (correct / asked):\n- Fractions: 3 / 4\n- Geometry: 1.5 / 3");
  for (const banned of ["temperature", "top_p", "fallbacks", "budget_tokens"]) assertFalse(banned in p);
});

function allObjectsClosed(node: any): boolean {
  if (!node || typeof node !== "object") return true;
  if (node.type === "object" && node.additionalProperties !== false) return false;
  return Object.values(node).every(allObjectsClosed);
}
Deno.test("schemas close every object", () => {
  const s = buildFeedbackSchema(["A", "B"]) as any;
  assertEquals(s.additionalProperties, false);
  assert(allObjectsClosed(s));
  assertEquals(s.properties.strengths.items.properties.skill.enum, ["A", "B"]);
  assert(allObjectsClosed(SCHOOL_SCHEMA));
});

Deno.test("school request carries no name", () => {
  const r = buildSchoolRequest([{ className: "Class 4", olympiad: "Maths", students: 20, schoolAvg: 61, stateAvg: 55, skills: [{ skill: "Fractions", school_pct: 70, state_pct: 60 }] }]);
  assert(JSON.stringify(r).includes("school average 61%"));
});

Deno.test("stripName", () => {
  assertEquals(stripName("Well done Arun!", "Arun Kumar"), "Well done!");
  assertEquals(stripName("Arun did very well.", "Arun Kumar"), "Did very well.");
  assertEquals(stripName("Well done, Kumar!", "Arun Kumar"), "Well done!");
  assertEquals(stripName("Arun's work is neat.", "Arun Kumar"), "Work is neat.");
  assertEquals(stripName("Great arunachal trip", "Arun Kumar"), "Great arunachal trip");
  assertEquals(stripName("Hi Al!", "Al Bo"), "Hi Al!"); // tokens under 3 chars are ignored
  assertEquals(stripName("Nothing here.", "Arun Kumar"), "Nothing here.");
});

Deno.test("validateFeedback checks shape, caps and skills", () => {
  const good = {
    overall: "Nice.", strengths: [{ skill: "Fractions", feedback: "ok" }], focus_areas: [{ skill: "Geometry", feedback: "ok" }],
    tips: ["a", "b", "c", "d"], goals: ["g"],
  };
  const v = validateFeedback(good, ["Fractions", "Geometry"])!;
  assertEquals(v.tips.length, 3);
  assertEquals(validateFeedback({ ...good, strengths: [{ skill: "Invented", feedback: "x" }] }, ["Fractions"]), null);
  assertEquals(validateFeedback({ overall: "x" }), null);
  assertEquals(validateFeedback(null), null);
});

Deno.test("JSONL lines: succeeded / errored / expired / canceled / refusal / junk", () => {
  const ok = JSON.stringify({ custom_id: "e1", result: { type: "succeeded", message: { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "{\"a\":1}" }] } } });
  assertEquals(parseResultLine(ok), { kind: "succeeded", customId: "e1", text: "{\"a\":1}", model: "claude-haiku-5-5" });
  const err = JSON.stringify({ custom_id: "e2", result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "x" } } } });
  assertEquals(parseResultLine(err), { kind: "failed", customId: "e2", reason: "overloaded_error" });
  assertEquals(parseResultLine(JSON.stringify({ custom_id: "e3", result: { type: "expired" } })), { kind: "failed", customId: "e3", reason: "expired" });
  assertEquals(parseResultLine(JSON.stringify({ custom_id: "e4", result: { type: "canceled" } })), { kind: "failed", customId: "e4", reason: "canceled" });
  const refusal = JSON.stringify({ custom_id: "e5", result: { type: "succeeded", message: { stop_reason: "refusal", content: [] } } });
  assertEquals(parseResultLine(refusal), { kind: "failed", customId: "e5", reason: "refused" });
  const cut = JSON.stringify({ custom_id: "e6", result: { type: "succeeded", message: { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] } } });
  assertEquals(parseResultLine(cut), { kind: "failed", customId: "e6", reason: "cut off" });
  assertEquals(parseResultLine(""), null);
  assertEquals(parseResultLine("{not json"), { kind: "invalid" });
});

Deno.test("readLines streams lines across chunk boundaries", async () => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode("one\ntw")); c.enqueue(enc.encode("o\n\nthree")); c.close(); },
  });
  const got: string[] = [];
  for await (const l of readLines(body)) got.push(l);
  assertEquals(got, ["one", "two", "", "three"]);
});

Deno.test("percent and chunk", () => {
  assertEquals(batchPercent(8000, 4880), 39);
  assertEquals(batchPercent(0, 0), 0);
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk(Array.from({ length: 25000 }, (_, i) => i), 10000).map((c) => c.length), [10000, 10000, 5000]);
});

Deno.test("custom_id unpack rejects junk", () => {
  assertEquals(unpackCustomId("e1"), null);
  assertEquals(unpackCustomId("z".repeat(64)), null);
  assertEquals(packCustomId("11111111-2222-3333-4444-555555555555", "AB".repeat(16)).length, 64);
});

Deno.test("groupBulkRows groups per student, keeps hash, honours the retry filter", () => {
  const r = (e: string, skill: string) => ({ enrollment_id: e, class_code: "04", olympiad_code: "MPO", grade: "A", skill, correct: "2.5", total: 3, basis_hash: "h" + e });
  const rows = [r("a", "S1"), r("a", "S2"), r("b", "S1"), { ...r("c", "S1"), total: 0 }];
  const all = groupBulkRows(rows);
  assertEquals(all.map((x) => [x.enrollmentId, x.skills.length, x.basisHash]), [["a", 2, "ha"], ["b", 1, "hb"]]);
  assertEquals(all[0].skills[0].correct, 2.5);
  assertEquals(groupBulkRows(rows, new Set(["b"])).map((x) => x.enrollmentId), ["b"]);
});
