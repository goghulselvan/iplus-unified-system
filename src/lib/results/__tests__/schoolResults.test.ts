import { describe, it, expect } from "vitest";
import { vsStateText, vsStateDiff } from "../schoolResults";

describe("vsStateText", () => {
  it("above", () => expect(vsStateText(6.2)).toBe("6% above state average"));
  it("below", () => expect(vsStateText(-4)).toBe("4% below state average"));
  it("same", () => {
    expect(vsStateText(0)).toBe("Same as state average");
    expect(vsStateText(0.3)).toBe("Same as state average");
  });
});
describe("vsStateDiff", () => {
  it("null when unknown", () => expect(vsStateDiff(null, 50)).toBeNull());
  it("difference", () => expect(vsStateDiff(60, 54)).toBe(6));
});
