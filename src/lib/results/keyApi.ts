import { supabase } from "@/integrations/supabase/client";
import type { CheckStatus, Letter } from "./questionRow";

export interface RecheckResult {
  question_number: number;
  answer: Letter | null;
  confidence: number;
  reason: string;
  key_answer: Letter | null;
  check_status: CheckStatus;
}

export interface RecheckResponse { results: RecheckResult[]; rechecked_at: string }

export interface ReadKeyResponse {
  answers: { question_number: number; answer: string | null }[];
  /** Questions the AI could not read an answer for. */
  missing: number[];
  /** Questions the key seems to answer twice with different letters. */
  conflicts: number[];
  total: number;
}

const GENERIC = "The AI could not do this right now. Please try again.";

/** Calls analyze-paper and returns the plain-English message when it fails. */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("analyze-paper", { body });
  let problem: string | null = data?.error ?? null;
  if (!problem && error) {
    try {
      const b = await (error as { context?: Response }).context?.json();
      problem = typeof b?.error === "string" ? b.error : null;
    } catch { /* keep the generic message */ }
    problem = problem ?? GENERIC;
  }
  if (problem) throw new Error(problem);
  return data as T;
}

export const recheckQuestions = (paperId: string, questionNumbers: number[]) =>
  call<RecheckResponse>({ action: "recheck", paperId, questionNumbers });

export const readKey = (paperId: string, fileKey: string) =>
  call<ReadKeyResponse>({ action: "read_key", paperId, fileKey });

/** Questions per recheck call: the AI works at high effort, so small batches stay inside the time limit. */
export const RECHECK_CHUNK = 5;

/** Rechecks in small chunks, reporting progress after each. Stops quietly when `shouldStop()` is true. */
export async function recheckInChunks(
  paperId: string,
  numbers: number[],
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean = () => false,
  chunk = RECHECK_CHUNK,
  recheck: typeof recheckQuestions = recheckQuestions,
): Promise<number> {
  let done = 0;
  onProgress(0, numbers.length);
  for (let i = 0; i < numbers.length; i += chunk) {
    if (shouldStop()) break;
    const part = numbers.slice(i, i + chunk);
    await recheck(paperId, part);
    done += part.length;
    onProgress(done, numbers.length);
  }
  return done;
}
