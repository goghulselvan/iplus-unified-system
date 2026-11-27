import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn(async () => {});
vi.mock("@/hooks/results/useEvaluations", () => ({ useManualEntry: () => ({ mutateAsync, isPending: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ManualMarksDialog } from "./ManualMarksDialog";

afterEach(() => { cleanup(); mutateAsync.mockClear(); });
const open = (current = { status: null, total: null, marks: null } as never) =>
  render(<ManualMarksDialog open onOpenChange={() => {}} enrollmentId="e1" studentName="Asha" questionCount={30} current={current} />);

describe("ManualMarksDialog", () => {
  it("refuses a total above the question count or not in steps of 0.5", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/Total \(0 to 30\)/), "31");
    await user.click(screen.getByRole("button", { name: "Save marks" }));
    expect(screen.getByRole("alert").textContent).toMatch(/0 to 30, in steps of 0.5/);
    await user.clear(screen.getByLabelText(/Total \(0 to 30\)/));
    await user.type(screen.getByLabelText(/Total \(0 to 30\)/), "12.3");
    await user.click(screen.getByRole("button", { name: "Save marks" }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("saves a total", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText(/Total \(0 to 30\)/), "27.5");
    await user.click(screen.getByRole("button", { name: "Save marks" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ enrollmentId: "e1", mode: "total", total: 27.5, marks: null }));
  });

  it("saves marks per question, empty counting as 0 on the server", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText("Marks per question"));
    await user.selectOptions(screen.getByLabelText("Q1"), "1");
    await user.selectOptions(screen.getByLabelText("Q2"), "0.5");
    expect(screen.getByText(/Total: 1.5/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save marks" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const arg = (mutateAsync.mock.calls[0] as unknown as [{ mode: string; marks: (number | null)[] }])[0];
    expect(arg.mode).toBe("questions");
    expect(arg.marks.slice(0, 3)).toEqual([1, 0.5, null]);
    expect(arg.marks).toHaveLength(30);
  });

  it("marks absent", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText("Absent"));
    await user.click(screen.getByRole("button", { name: "Mark absent" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ enrollmentId: "e1", mode: "absent", total: null, marks: null }));
  });
});
