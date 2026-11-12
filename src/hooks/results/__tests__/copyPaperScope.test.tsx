import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import { useCopyPaperFromSlot } from "../usePapers";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useCopyPaperFromSlot project isolation", () => {
  it("refuses to copy a paper from another olympiad project and writes nothing", async () => {
    const writes = vi.fn();
    from.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: "src", project_id: "p2025", class_code: "03", olympiad_code: "MPO" },
            { id: "tgt", project_id: "p2026", class_code: "03", olympiad_code: "MPO" },
          ],
          error: null,
        }),
      }),
      upsert: writes, update: writes, delete: writes,
    }));
    const { result } = renderHook(() => useCopyPaperFromSlot("src", "tgt", { replace: false }, "p2026"), { wrapper });
    await expect(result.current.mutateAsync(undefined)).rejects.toThrow(/same olympiad project/);
    expect(writes).not.toHaveBeenCalled();
    // Only the one scope check ran: no question counts, reads or writes after it.
    expect(from).toHaveBeenCalledTimes(1);
  });
});
