import { describe, expect, it } from "vitest";
import { fitWithin, isImageFile, MAX_EDGE } from "../downscaleImage";

describe("fitWithin", () => {
  it("shrinks the long edge to 2000 and keeps the shape", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: MAX_EDGE });
  });
  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("isImageFile", () => {
  it("treats photos as images and PDFs as not", () => {
    expect(isImageFile(new File([""], "key.JPG"))).toBe(true);
    expect(isImageFile(new File([""], "key.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
