import { describe, it, expect } from "vitest";
import { feedbackStage, withPercent, exportStage, summariseBatches, jobsNeedingRetry, retryLabel } from "../skillProgress";
import type { AiBatchRow } from "@/hooks/results/useSkills";

const b = (o: Partial<AiBatchRow>): AiBatchRow => ({
  id: "x", project_id: "p", school_id: null, status: "submitted", total: 0, succeeded: 0, errored: 0,
  errored_enrollment_ids: null, error: null, created_at: "", collected_at: null, ...o,
});

describe("skill progress text", () => {
  it("builds the feedback and export lines", () => {
    expect(withPercent(feedbackStage(3120, 8000), 39)).toBe("Claude is writing feedback: 3,120 of 8,000 students · 39%");
    expect(withPercent(exportStage(37, 212, "score sheets"), 17)).toBe("Making 37 of 212 score sheets · 17%");
  });
  it("rolls up open jobs only", () => {
    const s = summariseBatches([b({ total: 5000, succeeded: 2000, errored: 120 }), b({ status: "ended", total: 3000 }), b({ status: "collected", total: 999 })]);
    expect(s).toMatchObject({ total: 8000, done: 5120, percent: 64, running: true, waitingToCollect: true });
  });
  it("labels retries", () => {
    expect(retryLabel(12)).toBe("Try again for these 12 students");
    expect(retryLabel(1)).toBe("Try again for these 1 student");
  });
  it("lists only the latest finished job per school that had errors", () => {
    const rows = [b({ id: "new", status: "collected", errored: 3, school_id: "s1" }), b({ id: "old", status: "collected", errored: 9, school_id: "s1" }), b({ id: "ok", status: "collected", school_id: "s2" })];
    expect(jobsNeedingRetry(rows).map((r) => r.id)).toEqual(["new"]);
  });
});
