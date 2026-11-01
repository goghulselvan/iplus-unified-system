import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorList } from "./AiFeedbackPanel";
import type { AiBatchRow } from "@/hooks/results/useSkills";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [] }) }) }) } }));

const job = { id: "j", errored: 12, school_id: null } as AiBatchRow;

describe("ErrorList", () => {
  it("shows the count and a retry button", () => {
    const onRetry = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><ErrorList job={job} ids={[]} busy={false} onRetry={onRetry} /></QueryClientProvider>);
    expect(screen.getByText(/could not write feedback for 12 students/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again for these 12 students" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
