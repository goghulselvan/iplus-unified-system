import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiFeedbackPanel } from "./AiFeedbackPanel";

const collect = vi.fn();
const submit = vi.fn();
let batches: unknown[] = [];
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/results/useSkills", () => ({
  collectBatch: (...a: unknown[]) => collect(...a),
  submitFeedback: (...a: unknown[]) => submit(...a),
  useAiBatches: () => ({ isError: false, data: batches }),
}));

describe("AiFeedbackPanel saving", () => {
  it("shows the failure, clears the saving bar, and 'Try saving again' collects again", async () => {
    batches = [{ id: "b1", project_id: "p", school_id: null, status: "ended", total: 10, succeeded: 10, errored: 0, errored_enrollment_ids: null, error: null, created_at: "", collected_at: null }];
    collect.mockRejectedValueOnce(new Error("Claude is slow today.")).mockResolvedValue({ saved: 10, failedEnrollmentIds: [] });
    render(<QueryClientProvider client={new QueryClient()}><AiFeedbackPanel projectId="p" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("Claude is slow today.")).toBeTruthy());
    expect(screen.queryByText(/Saving the feedback/)).toBeNull();
    expect(collect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
  });

  it("'Try again for these N students' submits exactly the failed enrolment ids", async () => {
    batches = [{ id: "b2", project_id: "p", school_id: "s1", status: "collected", total: 3, succeeded: 1, errored: 2, errored_enrollment_ids: ["e1", "e2"], error: null, created_at: "", collected_at: "x" }];
    submit.mockResolvedValue({ total: 2, batches: ["b3"] });
    render(<QueryClientProvider client={new QueryClient()}><AiFeedbackPanel projectId="p" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Try again for these 2 students/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("p", "s1", ["e1", "e2"]));
  });
});
