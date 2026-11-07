import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { aiErrorMessage } from "./aiError.ts";

Deno.test("aiErrorMessage: credits, key, permission, busy, other", () => {
  assertStringIncludes(aiErrorMessage(402, { error: { type: "billing_error" } }), "run out of credits");
  assertStringIncludes(aiErrorMessage(400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), "run out of credits");
  assertStringIncludes(aiErrorMessage(401, { error: { type: "authentication_error" } }), "key is not valid");
  assertStringIncludes(aiErrorMessage(403, null), "not allowed");
  assertStringIncludes(aiErrorMessage(529, null), "busy");
  assertEquals(aiErrorMessage(400, { error: { type: "invalid_request_error", message: "bad field" } }), "The AI rejected the request: bad field");
  assertEquals(aiErrorMessage(400, null), "The AI rejected the request. Please contact the administrator.");
});
