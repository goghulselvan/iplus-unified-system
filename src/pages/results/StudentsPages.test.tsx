import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const row = (id: string, name: string) => ({
  enrollment_id: id, registration_number: "233030106011", student_name: name, school_id: "sc1", school_name: "Test School",
  class_code: "01", olympiad_code: "MPO", status: "evaluated", total: 5, percentage: 50, grade: "C",
  evaluation_id: `ev-${id}`, paper_id: "p1", deleted_at: null, total_count: 2,
});

const studentResult = vi.fn();

vi.mock("@/hooks/useOlympiadProjects", () => ({ useActiveProject: () => ({ data: { id: "proj" }, isLoading: false }) }));
vi.mock("@/hooks/results/usePapers", () => ({
  usePapers: () => ({ data: [{ id: "p1", total_questions: 10 }] }),
  useClasses: () => ({ data: [{ code: "01", display_name: "Class 1" }] }),
  useSlotTemplates: () => ({ data: [{ id: "s1" }, { id: "s2" }] }),
}));
vi.mock("@/hooks/results/useEvaluations", () => ({
  PAGE_SIZE: 50,
  useStudentList: () => ({ data: { rows: [row("e1", "Asha"), row("e2", "Bala")], total: 2 }, isLoading: false, isError: false }),
  useSchoolSearch: () => ({ data: [] }),
  useRestoreResult: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetAbsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteResults: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCorrectAnswer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResultHistory: () => ({ data: [], isLoading: false, isError: false }),
  findPapersForStudents: vi.fn(async () => [{ id: "p1", slot_template_id: "s1" }]),
  bookedSlotFor: vi.fn(async () => "s1"),
  useStudentResult: () => studentResult(),
}));

import StudentsPage from "./StudentsPage";
import StudentResultPage from "./StudentResultPage";
import { CorrectDialog } from "@/components/results/students/CorrectDialog";

afterEach(cleanup);

describe("Students pages", () => {
  it("opens 'Mark 2 students absent?' after selecting two rows", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    await user.click(screen.getByLabelText("Select Asha"));
    await user.click(screen.getByLabelText("Select Bala"));
    await user.click(screen.getByRole("button", { name: "Mark absent" }));
    expect(await screen.findByText("Mark 2 students absent?")).toBeTruthy();
  });

  it("tells staff when a student was marked absent", () => {
    studentResult.mockReturnValue({
      isLoading: false, isError: false,
      data: {
        enrollmentId: "e1", registrationNumber: "233030106011", name: "Asha", schoolName: "Test School", schoolId: "sc1",
        classCode: "01", olympiadCode: "MPO", evaluation: { id: "ev1", status: "absent", answers: null, marks: null, paper_id: "p1" },
        score: null, paper: null, questions: [], totals: null,
      },
    });
    render(
      <MemoryRouter initialEntries={["/results/students/e1"]}>
        <Routes><Route path="/results/students/:enrollmentId" element={<StudentResultPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/This student was marked absent/)).toBeTruthy();
  });

  it("blocks saving a correction until a reason is typed", async () => {
    const user = userEvent.setup();
    render(<CorrectDialog open onOpenChange={() => {}} evaluationId="ev1" question={3} current="A" kind="omr" />);
    const save = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Why are you changing this/), "Operator mis-keyed it");
    expect(save.disabled).toBe(true); // value unchanged
    await user.selectOptions(screen.getByLabelText(/New answer/), "B");
    expect(save.disabled).toBe(false);
  });
});
