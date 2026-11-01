import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchoolExports } from "./SchoolExports";

const gate: { release: () => void } = { release: () => {} };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/results/useSkills", () => ({
  fetchFeedback: async () => new Map(), fetchSchoolAnalysis: async () => null, fetchSchoolSkills: async () => new Map(),
}));
vi.mock("@/lib/results/pdf", () => ({
  lossyText: () => false, generateScoreSheet: async () => new Blob(["x"]), generateSkillReport: async () => new Blob(["x"]),
  generateSchoolRanking: async () => new Blob(["x"]), generateSchoolSummary: async () => new Blob(["x"]),
}));
vi.mock("@/lib/results/pdfData", async (orig) => ({
  ...(await orig<object>()),
  fetchSchoolRankRows: async () => [{ enrollment_id: "e1", student_name: "Asha", registration_number: "123", class_code: "01", olympiad_code: "MAT", total: 1, max_marks: 2, percentage: 50, grade: "C" }],
  fetchEvaluationAnswers: async () => new Map([["e1", { answers: ["A"], marks: null, paper_id: "p" }]]),
  fetchPaperQuestions: async () => [],
  groupTotals: async () => ({ school: 1, district: 1, state: 1, national: 1 }),
}));
vi.mock("@/lib/results/zipParts", () => ({
  zipPartName: () => () => "x.zip",
  streamZipParts: async (inputs: { make: () => Promise<Blob> }[]) => {
    await inputs[0].make();
    await new Promise<void>((r) => { gate.release = r; });
    return { parts: 0, files: 1 };
  },
}));

const school = { school_id: "s", school_name: "Test School", evaluated: 1, enrolled: 1, absent: 0, avg_percentage: 50 } as never;
const groups = [{ class_code: "01", olympiad_code: "MAT", evaluated: 1, class_name: "Class 1" }] as never;

describe("SchoolExports", () => {
  it("shows Cancel while a zip is being made, and not for a single PDF", async () => {
    render(<SchoolExports projectId="p" school={school} groups={groups} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Score-sheet zip/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    gate.release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull());
  });
});
