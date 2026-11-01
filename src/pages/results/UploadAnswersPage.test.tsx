import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const check = vi.fn();
const save = vi.fn();

vi.mock("@/hooks/useOlympiadProjects", () => ({ useActiveProject: () => ({ data: { id: "proj", project_name: "2026" }, isLoading: false }) }));
vi.mock("@/hooks/results/useEvaluations", () => ({
  useUploadRpc: () => ({ check, save }),
  fetchTemplateStudents: vi.fn(async () => []),
}));
vi.mock("@/hooks/results/usePapers", () => {
  const p = (id: string, cls: string, status = "ready") => ({
    id, project_id: "proj", class_code: cls, olympiad_code: "MPO", slot_template_id: "s1",
    total_questions: 2, status, entered: 2, answered: 2,
  });
  return {
    usePapers: () => ({ data: [p("a", "14"), p("b", "01"), p("c", "03"), p("d", "02", "draft")], isLoading: false, isError: false }),
    useClasses: () => ({ data: [
      { code: "14", display_name: "LKG", question_count: 2 }, { code: "01", display_name: "Class 1", question_count: 2 },
      { code: "02", display_name: "Class 2", question_count: 2 }, { code: "03", display_name: "Class 3", question_count: 2 },
    ] }),
    useSlotTemplates: () => ({ data: [{ id: "s1", slot_name: "Slot 1" }, { id: "s2", slot_name: "Slot 2" }] }),
  };
});

import UploadAnswersPage from "./UploadAnswersPage";

beforeEach(() => { check.mockReset(); save.mockReset(); });
afterEach(cleanup);

async function pickAndUpload(csv = "registration_number,Q1,Q2\n233030106011,1,0\n") {
  const user = userEvent.setup();
  render(<UploadAnswersPage />);
  await user.selectOptions(screen.getByLabelText(/which paper/i), "b");
  await user.upload(screen.getByLabelText(/answers file/i), new File([csv], "marks.csv", { type: "text/csv" }));
  return user;
}

describe("UploadAnswersPage", () => {
  it("shows 'Nothing was saved' and the row message when the check fails", async () => {
    check.mockResolvedValue({ ok: false, errors: [{ row: 2, message: "Row 2: 233030106011 is not a registered student in this project" }], moreErrors: 0 });
    await pickAndUpload();
    expect(await screen.findByText(/Nothing was saved/)).toBeTruthy();
    expect(screen.getByText(/Row 2: 233030106011 is not a registered student/)).toBeTruthy();
  });

  it("keeps Confirm disabled until 'I understand' is ticked when results will be replaced", async () => {
    check.mockResolvedValue({
      ok: true, dryRun: true, count: 10,
      replace: [1, 2, 3].map((i) => ({ reg: `r${i}`, name: `S${i}`, was: "evaluated" })),
      otherSlot: { count: 0, slotName: null }, missingFromFile: 0,
    });
    const user = await pickAndUpload();
    expect(await screen.findByText("3 students already have results and will be replaced")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm and save" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByLabelText("I understand"));
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it("lists only LKG to Class 2 papers on the Manual tab, greying papers that are not ready", () => {
    render(<UploadAnswersPage />);
    const opts = Array.from(screen.getByLabelText(/which paper/i).querySelectorAll("option")).map((o) => o.textContent);
    expect(opts.some((t) => t?.startsWith("LKG"))).toBe(true);
    expect(opts.some((t) => t?.startsWith("Class 1"))).toBe(true);
    expect(opts.some((t) => t?.includes("Class 3"))).toBe(false);
    expect(opts.find((t) => t?.startsWith("Class 2"))).toContain("Not ready yet");
    const draft = screen.getByRole("option", { name: /Class 2/ }) as HTMLOptionElement;
    expect(draft.disabled).toBe(true);
  });

  it("clears the file box after a failed check so the same file can be chosen again", async () => {
    check.mockResolvedValue({ ok: false, errors: [{ row: 2, message: "Row 2 problem" }], moreErrors: 0 });
    await pickAndUpload();
    await screen.findByText(/Nothing was saved/);
    expect((screen.getByLabelText(/answers file/i) as HTMLInputElement).value).toBe("");
  });

  it("locks the paper picker while a check is running", async () => {
    let release: (v: unknown) => void = () => {};
    check.mockReturnValue(new Promise((r) => { release = r; }));
    await pickAndUpload();
    await waitFor(() => expect((screen.getByLabelText(/which paper/i) as HTMLSelectElement).disabled).toBe(true));
    release({ ok: false, errors: [{ row: 2, message: "x" }], moreErrors: 0 });
    await waitFor(() => expect((screen.getByLabelText(/which paper/i) as HTMLSelectElement).disabled).toBe(false));
  });
});
