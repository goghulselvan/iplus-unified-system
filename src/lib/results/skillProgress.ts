import type { AiBatchRow } from "@/hooks/results/useSkills";

const n = (v: number) => v.toLocaleString("en-IN");
export const percentOf = (done: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0);

/** "Claude is writing feedback: 3,120 of 8,000 students" */
export const feedbackStage = (done: number, total: number) => `Claude is writing feedback: ${n(done)} of ${n(total)} students`;
/** "Making 37 of 212 score sheets" */
export const exportStage = (done: number, total: number, noun: string) => `Making ${n(done)} of ${n(total)} ${noun}`;
export const withPercent = (stage: string, pct: number) => `${stage} · ${Math.round(pct)}%`;
export const retryLabel = (count: number) => `Try again for these ${n(count)} ${count === 1 ? "student" : "students"}`;

export interface BatchSummary { total: number; done: number; percent: number; running: boolean; waitingToCollect: boolean }

/** Roll up the jobs that are still open (running, or finished and not yet saved). */
export function summariseBatches(rows: Pick<AiBatchRow, "status" | "total" | "succeeded" | "errored">[]): BatchSummary {
  const open = rows.filter((b) => b.status === "submitted" || b.status === "ended");
  const total = open.reduce((a, b) => a + b.total, 0);
  const done = open.reduce((a, b) => a + (b.status === "ended" ? b.total : Math.min(b.total, b.succeeded + b.errored)), 0);
  return {
    total, done, percent: percentOf(done, total),
    running: open.some((b) => b.status === "submitted"),
    waitingToCollect: open.some((b) => b.status === "ended"),
  };
}

/** The latest job per school (or whole project) that finished with students missing. */
export function jobsNeedingRetry(rows: AiBatchRow[]): AiBatchRow[] {
  const seen = new Set<string>();
  const out: AiBatchRow[] = [];
  for (const b of rows) { // newest first
    const k = b.school_id ?? "all";
    if (seen.has(k)) continue;
    seen.add(k);
    if (b.status === "collected" && b.errored > 0) out.push(b);
  }
  return out;
}
