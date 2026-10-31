import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/iplus-logo.png";
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

// --- logo ---
interface Logo { dataUrl: string; w: number; h: number }
let logoPromise: Promise<Logo | null> | null = null;

function loadLogo(): Promise<Logo | null> {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      // PNG signature + IHDR width/height
      if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
      const dv = new DataView(buf.buffer, buf.byteOffset);
      const w = dv.getUint32(16);
      const h = dv.getUint32(20);
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      return { dataUrl: "data:image/png;base64," + btoa(bin), w, h };
    } catch {
      return null;
    }
  })();
  return logoPromise;
}

// --- document ---
export interface Ctx { doc: jsPDF; logo: Logo | null; title: string; y: number }

export async function newDoc(title: string): Promise<Ctx> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logo = await loadLogo();
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
  ctx.y += 2;
}

export interface TableOpts {
  head: string[];
  body: (string | number)[][];
  columnStyles?: Record<number, { cellWidth?: number | "auto"; halign?: "left" | "center" | "right" }>;
  fontSize?: number;
  /** Optional per-cell colouring */
  cellColor?: (row: number, col: number, raw: string) => RGB | null;
}

export function table(ctx: Ctx, o: TableOpts) {
  const body = o.body.map((r) => r.map((c) => pdfSafe(c)));
  autoTable(ctx.doc, {
    startY: ctx.y,
    head: [o.head.map((h) => pdfSafe(h))],
    body,
    margin: { top: TOP, left: MARGIN, right: MARGIN, bottom: 20 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: o.fontSize ?? 10, cellPadding: 1.8, textColor: DARK, lineColor: LINE, lineWidth: 0.2, overflow: "linebreak" },
    headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: o.columnStyles,
    didParseCell: (d) => {
      if (d.section !== "body" || !o.cellColor) return;
      const c = o.cellColor(d.row.index, d.column.index, body[d.row.index]?.[d.column.index] ?? "");
      if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = "bold"; }
    },
  });
  const last = (ctx.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  ctx.y = (last?.finalY ?? ctx.y) + 6;
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
        doc.addImage(logo.dataUrl, "PNG", MARGIN, 8, w, h);
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
export const pct1 = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? "-" : `${(Math.round(n * 10) / 10).toFixed(1)}%`);
