import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReleaseSendPage from "./ReleaseSendPage";
import { SendHistory } from "@/components/results/release/SendHistory";

const state: { role: string; test: string | null; status: string } = { role: "manager", test: null, status: "done" };
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { role: state.role }, loading: false }) }));
vi.mock("@/hooks/useOlympiadProjects", () => ({ useActiveProject: () => ({ data: { id: "p1" }, isLoading: false }) }));
vi.mock("@/hooks/results/useResultsReads", () => ({
  plainError: (e: Error) => e,
  useSchoolSummary: () => ({ data: [{ school_id: "s1", school_name: "Asha School", released: true, evaluated: 5, pending: 0, resend_flag: false }], isLoading: false }),
}));
vi.mock("@/hooks/results/useRelease", async (orig) => ({
  ...(await orig<object>()),
  useResendFlags: () => ({ data: [] }),
  useWhatsAppTemplate: () => ({ data: false }),
  useSendBatches: () => ({ isLoading: false, data: [{ id: "b1", project_id: "p1", channel: "email", test_target: state.test, status: state.status, created_at: "2026-11-02T10:00:00Z", approved_at: null }] }),
  useSendItems: () => ({
    data: [
      { id: "i1", batch_id: "b1", school_id: "s1", target: "a@x.in", payload: { schoolName: "Sent School" }, status: "sent", error: null, sent_at: null, attempts: 1 },
      { id: "i3", batch_id: "b1", school_id: "s3", target: "c@x.in", payload: { schoolName: "Unknown School" }, status: "unknown", error: "Unknown. Check with the school before retrying.", sent_at: null, attempts: 1 },
      { id: "i2", batch_id: "b1", school_id: "s2", target: "b@x.in", payload: { schoolName: "Failed School" }, status: "failed", error: "Mailbox does not exist", sent_at: null, attempts: 1 },
    ],
  }),
}));

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("Release & Send", () => {
  afterEach(cleanup);
  beforeEach(() => { state.role = "manager"; state.test = null; state.status = "done"; });

  it("shows a manager only the plain message, with no Stage, Release or Send controls", () => {
    wrap(<ReleaseSendPage />);
    expect(screen.getByText("Only a superadmin can release or send results.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /stage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^release/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
  });

  it("gives a superadmin the Stage button, with WhatsApp disabled when no template exists", async () => {
    state.role = "superadmin";
    wrap(<ReleaseSendPage />);
    const send = await screen.findByRole("tab", { name: "Send" });
    send.focus();
    // Radix tabs activate on mouse down
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.mouseDown(send);
    expect(await screen.findByRole("button", { name: /^Stage/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "WhatsApp" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("WhatsApp template not set up yet")).toBeTruthy();
  });

  it("shows Retry on a failed row and none on a sent row", () => {
    wrap(<SendHistory projectId="p1" openId="b1" onOpen={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    const failedRow = screen.getByText("Failed School").closest("tr")!;
    expect(failedRow.textContent).toContain("Retry");
    expect(screen.getByText("Sent School").closest("tr")!.textContent).not.toContain("Retry");
    expect(screen.getByText("Unknown School").closest("tr")!.textContent).not.toContain("Retry");
    expect(screen.getByText("Mailbox does not exist")).toBeTruthy();
  });

  it("keeps Send disabled for a test batch until the test address is retyped", () => {
    state.test = "Me@Example.com";
    wrap(<SendHistory projectId="p1" openId="b1" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const go = screen.getByRole("button", { name: "Yes, try again" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the test address again/), { target: { value: "me@exampl.com" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the test address again/), { target: { value: " me@example.com " } });
    expect(go.disabled).toBe(false);
  });

  it("asks for no retyping on a real batch", () => {
    wrap(<SendHistory projectId="p1" openId="b1" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByLabelText(/again to confirm/)).toBeNull();
    expect((screen.getByRole("button", { name: "Yes, try again" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
