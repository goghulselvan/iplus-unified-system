import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/iplus-logo.png";
import watermarkUrl from "@/assets/watermark-bg.jpg";
import { pdfSafe } from "./text";

export type RGB = [number, number, number];

export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN = 14;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const TOP = 30; // content start on every page (below header)
export const BOTTOM = PAGE_H - 18;
export const BLUE: RGB = [55, 65, 130];
export const DARK: RGB = [34, 34, 34];
export const MUTED: RGB = [100, 100, 100];
export const LINE: RGB = [210, 210, 215];
export const HEADER_TEXT = "iPlus Olympiads 2026";

// --- grades (local copy; reconciled with grading.ts at merge) ---
export interface GradeInfo { grade: string; label: string; color: RGB }

export function studentGrade(pct: number): GradeInfo {
  if (pct >= 95) return { grade: "A++", label: "Olympiad Excellence", color: [21, 128, 61] };
  if (pct >= 90) return { grade: "A+", label: "National Level Potential", color: [22, 163, 74] };
  if (pct >= 80) return { grade: "A", label: "High Performer", color: [37, 99, 235] };
  if (pct >= 70) return { grade: "B+", label: "Strong Foundation", color: [8, 145, 178] };
  if (pct >= 60) return { grade: "B", label: "Satisfactory", color: [202, 138, 4] };
  if (pct >= 50) return { grade: "C", label: "Average", color: [234, 88, 12] };
  return { grade: "D", label: "Needs Academic Support", color: [220, 38, 38] };
}

export function schoolGrade(pct: number): GradeInfo {
  if (pct >= 80) return { grade: "A", label: "Excellent", color: [21, 128, 61] };
  if (pct >= 60) return { grade: "B", label: "Good", color: [37, 99, 235] };
  if (pct >= 40) return { grade: "C", label: "Average", color: [234, 88, 12] };
  return { grade: "D", label: "Needs Improvement", color: [220, 38, 38] };
}

// --- images (logo + page watermark), loaded once per session ---
export interface Img { dataUrl: string; w: number; h: number; format: "PNG" | "JPEG" }
export type Scaler = (bytes: Uint8Array, mime: string, targetW: number) => Promise<Img | null>;

function pngSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}
function jpegSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
    }
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
  }
  return null;
}
function toBase64(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Browser: downscale through a canvas to targetW wide (small opaque JPEG). Returns null when no canvas exists (node/jsdom). */
export const canvasScaler: Scaler = async (bytes, mime, targetW) => {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const w = Math.min(targetW, bmp.width);
    const h = Math.round((bmp.height / bmp.width) * w);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#ffffff"; // header sits on white; opaque JPEG avoids a per-PDF alpha mask
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    return { dataUrl: c.toDataURL("image/jpeg", 0.85), w, h, format: "JPEG" };
  } catch {
    return null;
  }
};

/** Exported for tests. Logo is always downscaled (never embed the 213 KB source per PDF). */
export async function buildLogo(bytes: Uint8Array, scale: Scaler = canvasScaler): Promise<Img | null> {
  return scale(bytes, "image/png", 200);
}
/** Watermark is already a ~6 KB JPEG: embed as is. */
export function buildWatermark(bytes: Uint8Array): Img | null {
  const sz = jpegSize(bytes);
  return sz ? { dataUrl: "data:image/jpeg;base64," + toBase64(bytes), ...sz, format: "JPEG" } : null;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

let logoPromise: Promise<Img | null> | null = null;
let wmPromise: Promise<Img | null> | null = null;
const cached = (get: () => Promise<Img | null>, slot: "logo" | "wm") => {
  const cur = slot === "logo" ? logoPromise : wmPromise;
  if (cur) return cur;
  const p = get().then((v) => {
    if (!v) { if (slot === "logo") logoPromise = null; else wmPromise = null; } // retry next time
    return v;
  });
  if (slot === "logo") logoPromise = p; else wmPromise = p;
  return p;
};
const loadLogo = () => cached(async () => { const b = await fetchBytes(logoUrl); return b && pngSize(b) ? buildLogo(b, activeScaler) : null; }, "logo");
const loadWatermark = () => cached(async () => { const b = await fetchBytes(watermarkUrl); return b ? buildWatermark(b) : null; }, "wm");
let activeScaler: Scaler = canvasScaler;
export function _setScaler(s: Scaler) { activeScaler = s; }
export function _resetImageCache() { logoPromise = null; wmPromise = null; }

// --- document ---
export interface Ctx { doc: jsPDF; logo: Img | null; title: string; y: number }

export async function newDoc(title: string): Promise<Ctx> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const [logo, wm] = await Promise.all([loadLogo(), loadWatermark()]);
  if (wm) {
    // Pale full-page background drawn first on every page (before content), embedded once via alias.
    const draw = () => { try { doc.addImage(wm.dataUrl, "JPEG", 0, 0, PAGE_W, PAGE_H, "iplus-wm", "FAST"); } catch { /* ignore */ } };
    draw();
    const orig = doc.addPage.bind(doc);
    (doc as unknown as { addPage: typeof doc.addPage }).addPage = (...a: Parameters<typeof doc.addPage>) => { const r = orig(...a); draw(); return r; };
  }
  return { doc, logo, title, y: TOP };
}

/** Draw text through pdfSafe. */
export function txt(doc: jsPDF, s: unknown, x: number, y: number, opts?: Parameters<jsPDF["text"]>[3]) {
  doc.text(pdfSafe(s), x, y, opts);
}

export function setFont(doc: jsPDF, size: number, bold = false, color: RGB = DARK) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/** Wrapped paragraph; handles page breaks. Returns nothing, updates ctx.y. */
export function paragraph(ctx: Ctx, s: string, opts: { size?: number; bold?: boolean; color?: RGB; indent?: number; gap?: number } = {}) {
  const { doc } = ctx;
  const size = opts.size ?? 10.5;
  const indent = opts.indent ?? 0;
  setFont(doc, size, opts.bold, opts.color ?? DARK);
  const lines: string[] = doc.splitTextToSize(pdfSafe(s), CONTENT_W - indent);
  const lh = size * 0.5;
  for (const line of lines) {
    if (ctx.y + lh > BOTTOM) { doc.addPage(); ctx.y = TOP; }
    doc.text(line, MARGIN + indent, ctx.y);
    ctx.y += lh;
  }
  ctx.y += opts.gap ?? 2;
}

export function sectionTitle(ctx: Ctx, s: string) {
  if (ctx.y + 14 > BOTTOM) { ctx.doc.addPage(); ctx.y = TOP; }
  setFont(ctx.doc, 13, true, BLUE);
  txt(ctx.doc, s, MARGIN, ctx.y);
  ctx.y += 2;
  ctx.doc.setDrawColor(...BLUE);
  ctx.doc.setLineWidth(0.4);
  ctx.doc.line(MARGIN, ctx.y, PAGE_W - MARGIN, ctx.y);
  ctx.y += 6;
}

/** Label/value grid, two columns. */
export function infoGrid(ctx: Ctx, fields: [string, string][]) {
  const { doc } = ctx;
  const colW = CONTENT_W / 2;
  for (let i = 0; i < fields.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const f = fields[i + c];
      if (!f) continue;
      const x = MARGIN + c * colW;
      setFont(doc, 10, true, MUTED);
      const label = pdfSafe(f[0]) + ":";
      doc.text(label, x, ctx.y);
      setFont(doc, 10.5, false, DARK);
      const lx = x + doc.getTextWidth(label) + 2;
      const lines: string[] = doc.splitTextToSize(pdfSafe(f[1] || "-"), colW - (lx - x) - 3);
      doc.text(lines[0] ?? "-", lx, ctx.y);
    }
    ctx.y += 6.5;
  }
  ctx.y += 2;
}

export interface Tile { label: string; value: string; color?: RGB; sub?: string }

export function tiles(ctx: Ctx, items: Tile[], perRow = 3) {
  const { doc } = ctx;
  const gap = 4;
  const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
  const h = 20;
  for (let i = 0; i < items.length; i += perRow) {
    if (ctx.y + h > BOTTOM) { doc.addPage(); ctx.y = TOP; }
    for (let c = 0; c < perRow; c++) {
      const t = items[i + c];
      if (!t) continue;
      const x = MARGIN + c * (w + gap);
      doc.setFillColor(243, 244, 250);
      doc.setDrawColor(...LINE);
      doc.roundedRect(x, ctx.y, w, h, 2, 2, "FD");
      setFont(doc, 9.5, true, MUTED);
      txt(doc, t.label, x + 3, ctx.y + 6);
      setFont(doc, 15, true, t.color ?? BLUE);
      txt(doc, t.value, x + 3, ctx.y + 13.5);
      if (t.sub) { setFont(doc, 9, false, MUTED); txt(doc, t.sub, x + 3, ctx.y + 18); }
    }
    ctx.y += h + gap;
  }
  ctx.y += 4;
}

export interface TableOpts {
  head: string[];
  body: (string | number)[][];
  columnStyles?: Record<number, { cellWidth?: number | "auto"; halign?: "left" | "center" | "right" }>;
  fontSize?: number;
  /** Optional per-cell colouring */
  cellColor?: (row: number, col: number, raw: string) => RGB | null;
  /** Side-by-side tables: left/right margins and explicit start row */
  margin?: { left: number; right: number };
  startY?: number;
  padding?: number;
  ellipsize?: boolean;
  /** Draw extra content over a body cell (e.g. bars) */
  drawCell?: (doc: jsPDF, row: number, col: number, x: number, y: number, w: number, h: number) => void;
  /** Do not move ctx.y; return finalY instead */
  noAdvance?: boolean;
}

export function table(ctx: Ctx, o: TableOpts): number {
  const body = o.body.map((r) => r.map((c) => pdfSafe(c)));
  autoTable(ctx.doc, {
    startY: o.startY ?? ctx.y,
    head: [o.head.map((h) => pdfSafe(h))],
    body,
    margin: { top: TOP, left: o.margin?.left ?? MARGIN, right: o.margin?.right ?? MARGIN, bottom: 20 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: o.fontSize ?? 10, cellPadding: o.padding ?? 1.8, textColor: DARK, lineColor: LINE, lineWidth: 0.2, overflow: o.ellipsize ? "ellipsize" : "linebreak" },
    headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: o.columnStyles,
    didDrawCell: (d) => {
      if (d.section === "body" && o.drawCell) o.drawCell(ctx.doc, d.row.index, d.column.index, d.cell.x, d.cell.y, d.cell.width, d.cell.height);
    },
    didParseCell: (d) => {
      if (d.section !== "body" || !o.cellColor) return;
      const c = o.cellColor(d.row.index, d.column.index, body[d.row.index]?.[d.column.index] ?? "");
      if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = "bold"; }
    },
  });
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  const fy = (last?.finalY ?? ctx.y) + 6;
  if (!o.noAdvance) ctx.y = fy;
  return fy;
}

/** Draw the header and "Page i of n" footer on every page, then return the PDF as a Blob. */
export function finish(ctx: Ctx, subtitle?: string): Blob {
  const { doc, logo, title } = ctx;
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    let textX = MARGIN;
    if (logo) {
      try {
        const h = 11;
        const w = (logo.w / logo.h) * h;
        doc.addImage(logo.dataUrl, logo.format, MARGIN, 8, w, h, "iplus-logo", "FAST");
        textX = MARGIN + w + 4;
      } catch { /* fall back to text header */ }
    }
    setFont(doc, 12, true, BLUE);
    txt(doc, HEADER_TEXT, textX, 13);
    setFont(doc, 10, false, MUTED);
    txt(doc, subtitle ? `${title} | ${subtitle}` : title, textX, 18);
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, 22, PAGE_W - MARGIN, 22);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 16, PAGE_W - MARGIN, PAGE_H - 16);
    setFont(doc, 9, false, MUTED);
    txt(doc, `${HEADER_TEXT}  |  Page ${p} of ${n}`, PAGE_W / 2, PAGE_H - 10, { align: "center" });
  }
  return doc.output("blob");
}

export const ordinalOf = (rank: number | null | undefined, of: number | null | undefined): string =>
  rank == null ? "-" : of != null ? `${rank} of ${of}` : String(rank);
/** Whole-number percentage, e.g. "73%". */
export const pct = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? "-" : `${Math.round(n)}%`);

export function bandColor(p: number): RGB {
  return p >= 80 ? [21, 128, 61] : p >= 50 ? [217, 119, 6] : [220, 38, 38];
}

/** "7 points above state average" etc. (whole numbers). */
export function vsState(avg: number, state: number | null | undefined, short = false): string {
  if (state == null || Number.isNaN(state)) return short ? "-" : "State average not available";
  const d = Math.round(avg) - Math.round(state);
  if (d === 0) return short ? "Same" : "Same as state average";
  const n = Math.abs(d);
  return short ? `${n} pts ${d > 0 ? "above" : "below"}` : `${n} point${n === 1 ? "" : "s"} ${d > 0 ? "above" : "below"} state average`;
}
