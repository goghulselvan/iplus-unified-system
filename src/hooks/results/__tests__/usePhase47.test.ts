import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() } }));

import { findEnrollmentByReg, friendlyError } from "../usePhase47";

beforeEach(() => rpc.mockReset());

describe("findEnrollmentByReg", () => {
  it("sends the 12 digits of a hyphenated number to the server and maps the student", async () => {
    rpc.mockResolvedValue({
      data: [{ enrollment_id: "e1", registration_number: "2-33-03-06-01-020", student_name: "Asha K", school_name: "ABC School", class_code: "01", olympiad_code: "MPO" }],
      error: null,
    });
    const r = await findEnrollmentByReg("p1", "2-33-03-06-01-020");
    expect(rpc).toHaveBeenCalledWith("results_find_enrollment", { p_project_id: "p1", p_reg: "233030601020" });
    expect(r).toEqual({ enrollmentId: "e1", regNumber: "2-33-03-06-01-020", name: "Asha K", schoolName: "ABC School", classCode: "01", olympiad: "MPO" });
  });
  it("returns null without calling the server for a short number, and for no match", async () => {
    expect(await findEnrollmentByReg("p1", "123")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await findEnrollmentByReg("p1", "233030601020")).toBeNull();
  });
});

describe("friendlyError", () => {
  it("maps timeout, duplicate and check errors to plain sentences", () => {
    expect(friendlyError({ code: "57014", message: "canceling statement due to statement timeout" }, "x").message).toBe("This took too long. Please try again in a minute, or ask the administrator.");
    expect(friendlyError({ code: "23505", message: "duplicate key value violates unique constraint" }, "x").message).toBe("This was already saved by someone else. Please refresh.");
    expect(friendlyError({ code: "23514", message: "violates check constraint" }, "x").message).toMatch(/not allowed/);
  });
  it("keeps our own plain messages", () => {
    expect(friendlyError({ code: "P0001", message: "Add a note saying why." }, "x").message).toBe("Add a note saying why.");
  });
});
