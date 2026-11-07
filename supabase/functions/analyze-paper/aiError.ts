// Plain-English message for a failed Claude API response, so staff (and Goghul) can tell
// "no credits" from "bad key" from "busy". Never includes the key or request body.
export function aiErrorMessage(status: number, body: unknown): string {
  // deno-lint-ignore no-explicit-any
  const err = (body as any)?.error;
  const type: string = typeof err?.type === "string" ? err.type : "";
  const detail: string = typeof err?.message === "string" ? err.message.slice(0, 160) : "";
  if (status === 402 || type === "billing_error" || /credit balance/i.test(detail)) {
    return "The AI account has run out of credits. Please add credits in the Anthropic Console (Billing), then try again.";
  }
  if (status === 401 || type === "authentication_error") {
    return "The AI key is not valid. Please check the ANTHROPIC_API_KEY secret in Supabase.";
  }
  if (status === 403 || type === "permission_error") {
    return "The AI key is not allowed to use this model. Please check the key's workspace in the Anthropic Console.";
  }
  if (status === 429 || status === 529 || status >= 500 || type === "rate_limit_error" || type === "overloaded_error") {
    return "The AI is busy right now. Please try again in a minute.";
  }
  return detail ? `The AI rejected the request: ${detail}` : "The AI rejected the request. Please contact the administrator.";
}

export async function readAiError(res: Response): Promise<string> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch { /* not JSON */ }
  // deno-lint-ignore no-explicit-any
  console.log(JSON.stringify({ aiStatus: res.status, aiErrorType: (body as any)?.error?.type ?? null }));
  return aiErrorMessage(res.status, body);
}
