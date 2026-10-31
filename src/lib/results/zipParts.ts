import JSZip from "jszip";

export interface ZipFileInput {
  name: string;
  blob: Blob;
}

export interface ZipPart {
  /** 1-based part number */
  index: number;
  total: number;
  name: string;
  blob: Blob;
  fileNames: string[];
  /** true when this part holds a single file bigger than the cap */
  oversize: boolean;
}

export const DEFAULT_ZIP_MAX_BYTES = 25 * 1024 * 1024;
/** Conservative per-file zip overhead (local header + central directory entry). */
const PER_FILE_OVERHEAD = 1024;
const BASE_OVERHEAD = 1024;

export function defaultPartName(i: number, n: number): string {
  return `Part ${i} of ${n}.zip`;
}

/**
 * Pack files, in input order, into zip parts no larger than maxBytes.
 * A new part starts before the cap would be exceeded. A single file larger than the cap
 * goes alone in its own part (flagged `oversize`). PDFs are stored, not deflated.
 */
export async function buildZipParts(
  files: ZipFileInput[],
  maxBytes: number = DEFAULT_ZIP_MAX_BYTES,
  onProgress?: (pct: number) => void,
  partName: (i: number, n: number) => string = defaultPartName,
): Promise<ZipPart[]> {
  const groups: ZipFileInput[][] = [];
  let current: ZipFileInput[] = [];
  let size = BASE_OVERHEAD;
  for (const f of files) {
    const cost = f.blob.size + PER_FILE_OVERHEAD;
    if (current.length > 0 && size + cost > maxBytes) {
      groups.push(current);
      current = [];
      size = BASE_OVERHEAD;
    }
    current.push(f);
    size += cost;
  }
  if (current.length > 0) groups.push(current);

  const total = groups.length;
  const totalFiles = files.length || 1;
  let done = 0;
  const parts: ZipPart[] = [];
  onProgress?.(0);
  for (let g = 0; g < groups.length; g++) {
    const zip = new JSZip();
    // De-duplicate names within a part so nothing is silently overwritten.
    const used = new Set<string>();
    for (const f of groups[g]) {
      let name = f.name;
      let n = 1;
      while (used.has(name)) {
        const dot = f.name.lastIndexOf(".");
        name = dot > 0 ? `${f.name.slice(0, dot)} (${++n})${f.name.slice(dot)}` : `${f.name} (${++n})`;
      }
      used.add(name);
      zip.file(name, await f.blob.arrayBuffer(), { compression: "STORE" });
      done++;
      onProgress?.(Math.round((done / totalFiles) * 90));
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const blob = new Blob([bytes], { type: "application/zip" });
    parts.push({
      index: g + 1,
      total,
      name: partName(g + 1, total),
      blob,
      fileNames: groups[g].map((f) => f.name),
      oversize: groups[g].length === 1 && groups[g][0].blob.size + BASE_OVERHEAD + PER_FILE_OVERHEAD > maxBytes,
    });
  }
  onProgress?.(100);
  return parts;
}
