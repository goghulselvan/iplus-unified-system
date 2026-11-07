import { describe, it, expect } from "vitest";
import { friendlyError } from "../friendlyError";

describe("friendlyError", () => {
  it("shows only our own P0001 messages as written", () => {
    expect(friendlyError({ code: "P0001", message: "Add a note saying why." }, "x").message).toBe("Add a note saying why.");
  });
  it("never shows raw text for other errors, even short ones", () => {
    const raw = 'duplicate key value violates unique constraint "foo_pkey"';
    expect(friendlyError({ message: raw }, "fallback").message).toBe("fallback");
    expect(friendlyError({ code: "23503", message: 'insert on table "x" violates foreign key' }, "fallback").message).toBe("fallback");
  });
  it("maps known codes to plain sentences", () => {
    expect(friendlyError({ code: "57014", message: "canceling statement due to statement timeout" }, "x").message).toMatch(/too long/);
    expect(friendlyError({ code: "23505" }, "x").message).toMatch(/already saved/);
    expect(friendlyError({ code: "23514" }, "x").message).toMatch(/not allowed/);
    expect(friendlyError({ code: "22P02" }, "x").message).toMatch(/not valid/);
    expect(friendlyError({ code: "PGRST202" }, "x").message).toMatch(/not available/);
    expect(friendlyError({ code: "42501" }, "x").message).toMatch(/permission/);
    expect(friendlyError({ message: 'new row violates row-level security policy for table "t"' }, "x").message).toMatch(/permission/);
  });
  it("uses a generic fallback when nothing is given", () => {
    expect(friendlyError(null).message).toBe("That did not work. Please try again.");
  });
});
