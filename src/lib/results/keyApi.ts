import { supabase } from "@/integrations/supabase/client";
import type { CheckStatus, Letter } from "./questionRow";

export interface RecheckResult {
  question_number: number;
  answer: Letter | null;
  confidence: number;
  reason: string;
  check_status: CheckStatus;
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
  call<{ rechecked: number; results: RecheckResult[] }>({ action: "recheck", paperId, questionNumbers });

export const readKey = (paperId: string, fileKey: string) =>
  call<{ answers: { question_number: number; answer: string | null }[] }>({ action: "read_key", paperId, fileKey });

/** Rechecks in chunks of 20, reporting progress. Stops quietly when `shouldStop()` is true. */
export async function recheckInChunks(
  paperId: string,
  numbers: number[],
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean = () => false,
  chunk = 20,
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
