import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const check = vi.fn();
const save = vi.fn();
const modes: string[] = [];

vi.mock("@/hooks/results/useResultsProject", () => ({ useResultsProject: () => ({ ...{ data: { id: "proj", project_name: "2026" }, isLoading: false }, needsChoice: false, projects: [] }), chooseResultsProject: vi.fn() }));
vi.mock("@/hooks/results/useOmrUpload", () => ({
  useOmrUploadRpc: (mode = "omr") => { modes.push(mode); return { check, save }; },
}));

import UploadAnswersPage from "./UploadAnswersPage";

beforeEach(() => { check.mockReset(); save.mockReset(); modes.length = 0; });
afterEach(cleanup);

async function uploadManual(csv: string) {
  const user = userEvent.setup();
  render(<UploadAnswersPage />);
  await user.upload(screen.getByLabelText("Marks file"), new File([csv], "marks.csv", { type: "text/csv" }));
  return user;
}

describe("UploadAnswersPage — Manual tab (LKG to Class 2)", () => {
  it("sends a totals-only file as totals and per-question files as marks", async () => {
    check.mockResolvedValue({ ok: false, errors: [{ row: 2, kind: "not_in_crm", reg: "x", message: "Row 2 problem" }], moreErrors: 0 });
    await uploadManual("Roll Number,Name,Total\n133380801001,Kavi,27.5\n");
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(modes).toContain("manual");
    expect(check.mock.calls[0][0].rows).toEqual([{ row: 2, sheet: null, reg: "133380801001", kind: "total", total: "27.5" }]);
    cleanup(); check.mockClear();
    await uploadManual("Reg No,Name,Q1,Q2,Total\n133380801001,Kavi,1,,1\n");
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(check.mock.calls[0][0].rows[0]).toMatchObject({ kind: "questions", values: ["1", null] });
  });

  it("shows that nothing was saved, with the grouped problem and the row message", async () => {
    check.mockResolvedValue({
      ok: false, moreErrors: 0,
      errors: [{ row: 2, sheet: "EPO-Class1", kind: "not_in_crm", reg: "133380801001", message: 'Sheet "EPO-Class1", row 2: 133380801001 is not a registered student in this project' }],
    });
    await uploadManual("Roll Number,Name,Total\n133380801001,Kavi,27.5\n");
    expect(await screen.findByText(/Nothing has been stored/)).toBeTruthy();
    expect(screen.getByText("1 roll number is not in the CRM")).toBeTruthy();
    expect(screen.getByText(/133380801001 is not a registered student/)).toBeTruthy();
  });

  it("lists rows with no marks as skipped, and needs 'I understand' when results are replaced", async () => {
    check.mockResolvedValue({
      ok: true, dryRun: true, count: 3, replacing: 1,
      replace: [{ reg: "r1", name: "S1", was: "evaluated" }],
      papers: [{ classCode: "01", className: "Class 1", olympiadCode: "EPO", olympiad: "English", slotName: "Slot 1", count: 3, totalsOnly: 3 }],
      skipped: [{ row: 4, sheet: null, reg: "133380801009", name: "Mani" }],
    });
    const user = await uploadManual("Roll Number,Name,Total\n133380801001,Kavi,27.5\n");
    expect(await screen.findByText(/1 row has no marks and will be skipped/)).toBeTruthy();
    expect(screen.getByText("Total only")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Save 3 students" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByLabelText("I understand"));
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it("clears the file box after a failed check so the same file can be chosen again", async () => {
    check.mockResolvedValue({ ok: false, errors: [{ row: 2, kind: "unread", reg: null, message: "Row 2 problem" }], moreErrors: 0 });
    await uploadManual("Roll Number,Name,Total\n,Kavi,27.5\n");
    await screen.findByText(/Nothing has been stored/);
    expect((screen.getByLabelText("Marks file") as HTMLInputElement).value).toBe("");
  });
});
