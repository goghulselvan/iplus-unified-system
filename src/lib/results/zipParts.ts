import JSZip from "jszip";

export interface ZipFileInput {
  name: string;
  /** Eager blob, or a lazy producer (preferred for hundreds of PDFs: made, zipped, then released). */
  blob?: Blob;
  make?: () => Promise<Blob>;
}

export interface ZipPart {
  /** 1-based part number */
  index: number;
  /** Total parts, only known when `totalHint` was given or via the buildZipParts wrapper */
  total?: number;
  name: string;
  blob: Blob;
  fileNames: string[];
  /** true when this part holds a single file bigger than the cap */
  oversize: boolean;
}

export const DEFAULT_ZIP_MAX_BYTES = 25 * 1024 * 1024;
const encoder = new TextEncoder();
const FIXED_PER_FILE = 76; // local header 30 + central entry 46
const END_RECORD = 22;

/**
 * Conservative size of one stored entry: headers (name appears twice) + data.
 * JSZip also writes a Unicode-path extra field for non-ASCII names (name twice more), so count 4x then.
 */
export function entryCost(name: string, dataBytes: number): number {
  const n = encoder.encode(name).length;
  const copies = n === name.length ? 2 : 4;
  return FIXED_PER_FILE + 16 + copies * n + dataBytes;
}

export function defaultPartName(i: number, n?: number): string {
  return n ? `Part ${i} of ${n}.zip` : `Part ${i}.zip`;
}

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
/** "School name - Score sheets - Part 1 of 2.zip" */
export const zipPartName = (...labels: string[]) => (i: number, n?: number) =>
  `${labels.map(sanitize).filter(Boolean).join(" - ")} - ${n ? `Part ${i} of ${n}` : `Part ${i}`}.zip`;

export interface StreamOptions {
  maxBytes?: number;
  /** Receives each finished part; caller downloads/uploads it and drops it. */
  onPart: (part: ZipPart) => void | Promise<void>;
  onProgress?: (pct: number) => void;
  partName?: (i: number, n?: number) => string;
  /** Number of inputs, for progress when `inputs` is an async iterable */
  count?: number;
  /** Expected number of parts, only used to name them "Part i of N" */
  totalHint?: number;
}

/** Streaming core: packs in input order, keeps a running size, flushes a part before the cap would be exceeded. */
export async function streamZipParts(
  inputs: Iterable<ZipFileInput> | AsyncIterable<ZipFileInput>,
  o: StreamOptions,
): Promise<{ parts: number; files: number }> {
  const max = o.maxBytes ?? DEFAULT_ZIP_MAX_BYTES;
  const nameFn = o.partName ?? defaultPartName;
  const count = o.count ?? (Array.isArray(inputs) ? inputs.length : undefined);
  let zip = new JSZip();
  let names: string[] = [];
  let used = new Set<string>();
  let size = END_RECORD;
  let parts = 0;
  let files = 0;

  const flush = async () => {
    if (names.length === 0) return;
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    parts++;
    const part: ZipPart = {
      index: parts,
      total: o.totalHint,
      name: nameFn(parts, o.totalHint),
      blob: new Blob([bytes], { type: "application/zip" }),
      fileNames: names,
      oversize: names.length === 1 && size > max,
    };
    zip = new JSZip(); names = []; used = new Set(); size = END_RECORD;
    await o.onPart(part);
  };

  o.onProgress?.(0);
  for await (const f of inputs as AsyncIterable<ZipFileInput>) {
    const blob = f.blob ?? (await f.make!());
    let name = f.name;
    let n = 1;
    while (used.has(name)) {
      const dot = f.name.lastIndexOf(".");
      name = dot > 0 ? `${f.name.slice(0, dot)} (${++n})${f.name.slice(dot)}` : `${f.name} (${++n})`;
    }
    const cost = entryCost(name, blob.size);
    if (names.length > 0 && size + cost > max) await flush();
    used.add(name);
    zip.file(name, await blob.arrayBuffer(), { compression: "STORE" });
    names.push(f.name);
    size += cost;
    files++;
    if (count) o.onProgress?.(Math.min(99, Math.round((files / count) * 100)));
  }
  await flush();
  o.onProgress?.(100);
  return { parts, files };
}

/** Convenience wrapper: retains every part. Prefer streamZipParts for large sets. */
export async function buildZipParts(
  files: ZipFileInput[],
  maxBytes: number = DEFAULT_ZIP_MAX_BYTES,
  onProgress?: (pct: number) => void,
  partName: (i: number, n?: number) => string = defaultPartName,
): Promise<ZipPart[]> {
  const out: ZipPart[] = [];
  await streamZipParts(files, { maxBytes, onProgress, partName, onPart: (p) => { out.push(p); } });
  for (const p of out) { p.total = out.length; p.name = partName(p.index, out.length); }
  return out;
}
