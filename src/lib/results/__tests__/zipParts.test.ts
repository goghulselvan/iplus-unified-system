import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildZipParts } from "../zipParts";

const MB = 1024 * 1024;
const fake = (n: number, mb: number) => ({ name: `f${n}.pdf`, blob: new Blob([new Uint8Array(mb * MB)]) });

describe("buildZipParts", () => {
  it("splits 6 x 10 MB into 3 parts under the cap, keeping order", async () => {
    const files = [1, 2, 3, 4, 5, 6].map((n) => fake(n, 10));
    const pcts: number[] = [];
    const parts = await buildZipParts(files, 25 * MB, (p) => pcts.push(p), (i, n) => `S - Part ${i} of ${n}.zip`);
    expect(parts).toHaveLength(3);
    expect(parts[0].name).toBe("S - Part 1 of 3.zip");
    for (const p of parts) { expect(p.blob.size).toBeLessThanOrEqual(25 * MB); expect(p.oversize).toBe(false); }
    expect(parts.flatMap((p) => p.fileNames)).toEqual(files.map((f) => f.name));
    const zip = await JSZip.loadAsync(await parts[1].blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(["f3.pdf", "f4.pdf"]);
    expect(pcts[pcts.length - 1]).toBe(100);
  });

  it("puts a file larger than the cap alone and flags it", async () => {
    const parts = await buildZipParts([fake(1, 1), fake(2, 3), fake(3, 1)], 2 * MB);
    expect(parts.map((p) => p.fileNames)).toEqual([["f1.pdf"], ["f2.pdf"], ["f3.pdf"]]);
    expect(parts.map((p) => p.oversize)).toEqual([false, true, false]);
  });

  it("returns no parts for no files", async () => {
    expect(await buildZipParts([])).toEqual([]);
  });
});
