import { describe, expect, it } from "vitest";
import { describeChange } from "./history";

describe("describeChange", () => {
  it("lists changed answers", () => {
    expect(describeChange({ action: "UPDATE", before: { answers: ["A", "B"] }, after: { answers: ["A", "C"] } })).toEqual(["Q2: B → C"]);
  });
  it("names delete and restore", () => {
    expect(describeChange({ action: "UPDATE", before: { deleted_at: null }, after: { deleted_at: "x" } })).toEqual(["Result deleted"]);
    expect(describeChange({ action: "UPDATE", before: { deleted_at: "x" }, after: { deleted_at: null } })).toEqual(["Result restored"]);
  });
});
