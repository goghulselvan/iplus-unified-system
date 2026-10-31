import { describe, it, expect } from "vitest";
import { pdfSafe } from "../pdf/text";

describe("pdfSafe", () => {
  it("strips U+202F and U+00A0 to plain spaces", () => {
    expect(pdfSafe("10 AM sharp")).toBe("10 AM sharp");
  });
  it("writes rupee as Rs. and keeps WinAnsi chars", () => {
    expect(pdfSafe("₹200 – café ½")).toBe("Rs.200 – café ½");
  });
  it("replaces unsupported scripts and removes zero-width chars", () => {
    expect(pdfSafe("a​b தமிழ்")).toBe("ab ?????");
  });
  it("maps result ticks to words and handles null", () => {
    expect(pdfSafe("✓")).toBe("Correct");
    expect(pdfSafe("✗")).toBe("Wrong");
    expect(pdfSafe(null)).toBe("");
  });
});
