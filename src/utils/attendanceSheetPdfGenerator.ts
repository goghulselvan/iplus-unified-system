import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import iplusLogoUrl from '@/assets/iplus-logo.png';

export interface AttendanceRow {
  name: string;
  classCode: string; // "01".."08", "14" (LKG), "15" (UKG)
  subject: string; // alphabetical_code, e.g. "EPO"
  registrationNumber: string | null;
}

export interface AttendanceInput {
  schoolName: string;
  ssNo: number | string | null;
  schoolCode: string | null; // 6-digit state+district+school block, e.g. "331201"
  rows: AttendanceRow[];
}

const CLASS_LABEL: Record<string, string> = {
  '01': '1', '02': '2', '03': '3', '04': '4', '05': '5', '06': '6', '07': '7', '08': '8',
  '14': 'LKG', '15': 'UKG',
};
const CLASS_ORDER = ['01', '02', '03', '04', '05', '06', '07', '08', '14', '15'];
const SUBJECT_ORDER = ['EPO', 'MPO', 'SPO', 'GKSSPO', 'LRPO', 'KidsPO'];
const SUBJECT_FULL: Record<string, string> = {
  EPO: 'English Plus Olympiad', MPO: 'Maths Plus Olympiad', SPO: 'Science Plus Olympiad',
  GKSSPO: 'GK & Social Science Plus Olympiad', LRPO: 'Logical Reasoning Plus Olympiad', KidsPO: 'Kids Plus Olympiad',
};

// A roll number is only unique within one school + one class + one subject —
// verified against the live DB (7,752 registration numbers contain just 77
// distinct roll values; 617 collisions at school+class, 2,076 at
// school+subject). Every table block below is therefore scoped to exactly one
// subject and one class, which is the only scope where a bare roll is
// unambiguous. Do not flatten these groupings.
function extractRoll(regNo: string | null): string {
  if (!regNo) return 'Pending';
  const parts = regNo.split('-');
  return parts.length === 6 ? parts[5] : regNo;
}

// pdf-lib's standard fonts are WinAnsi-encoded and throw mid-render on anything
// outside CP1252 — Tamil throws outright (`WinAnsi cannot encode "த"`), which
// for TN/PY schools would otherwise kill the whole download with no error shown.
// Mirrors sanitize() in studentNamelistPdfGenerator.ts.
function sanitize(text: string): string {
  const out = String(text ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–]/g, '-')
    .replace(/[   -​  　]/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return out || '—';
}

function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  let i = 0;
  while (i < words.length) {
    const attempt = current ? `${current} ${words[i]}` : words[i];
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth || !current) { current = attempt; i++; }
    else { lines.push(current); current = ''; if (lines.length === maxLines) break; }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (i < words.length && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (font.widthOfTextAtSize(`${last}…`, size) > maxWidth && last.length > 1) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

// Brand navy/gold off the corporate letterhead — deliberately NOT the
// namelist's indigo/violet. Both documents land on the same exam desk on the
// same morning and must never be mistaken for each other.
const NAVY = rgb(0.047, 0.035, 0.478);
const GOLD = rgb(0.992, 0.698, 0.000);
const INK = rgb(0.10, 0.10, 0.14);
const MUTED = rgb(0.42, 0.45, 0.51);
const GRID = rgb(0.72, 0.73, 0.80);
const GRID_SOFT = rgb(0.86, 0.87, 0.91);
const BOX_BG = rgb(0.985, 0.985, 0.995);
const META_BG = rgb(0.96, 0.965, 0.99);
const CLASS_BG = rgb(0.93, 0.94, 0.98);
const ROW_ALT = rgb(0.975, 0.976, 0.99);
const WHITE = rgb(1, 1, 1);
const SUBTITLE = rgb(0.80, 0.82, 0.95);

const W = 595.28, H = 841.89; // A4 portrait
const MARGIN = 36;
const TABLE_W = W - MARGIN * 2;
const HEADER_BAND_H = 64;
const ROW_H = 26;          // taller than the namelist's 20: room to write a mark
const HEAD_H = 24;
const CLASS_BAND_H = 22;
const TOTALS_H = 24;
const FOOTER_LIMIT = 92;   // keeps the totals strip off the page footer

const COL = (() => {
  const sno = 42, roll = 86, mark = 120;
  return [
    { key: 'sno', label: 'S.No', x: MARGIN, w: sno },
    { key: 'roll', label: 'Roll No.', x: MARGIN + sno, w: roll },
    { key: 'name', label: 'Student Name', x: MARGIN + sno + roll, w: TABLE_W - sno - roll - mark },
    { key: 'mark', label: 'Attendance', x: MARGIN + TABLE_W - mark, w: mark },
  ];
})();

/**
 * Generates the Attendance Sheet PDF: one section per subject (fresh page
 * each), classes running continuously within a subject, a blank box per student
 * to mark, a Total/Present/Absent strip per class, and signature lines once per
 * subject. Date/Session is left blank — schools sit either Slot 1 or Slot 2 and
 * nothing here assumes which.
 */
export async function generateAttendanceSheetPdf({ schoolName, ssNo, schoolCode, rows }: AttendanceInput): Promise<Uint8Array> {
  const bySubject = new Map<string, Map<string, AttendanceRow[]>>();
  for (const s of SUBJECT_ORDER) bySubject.set(s, new Map());
  for (const r of rows) {
    const cm = bySubject.get(r.subject);
    if (!cm) continue;
    if (!cm.has(r.classCode)) cm.set(r.classCode, []);
    cm.get(r.classCode)!.push(r);
  }
  for (const cm of bySubject.values()) {
    for (const l of cm.values()) l.sort((a, b) => a.name.localeCompare(b.name));
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await fetch(iplusLogoUrl).then((r) => r.arrayBuffer());
  const logoImg = await pdfDoc.embedPng(logoBytes);

  const fullName = sanitize(ssNo != null ? `${schoolName} (SS ${ssNo})` : schoolName);
  const code = sanitize(schoolCode || '—');

  let page: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  // A tick has no WinAnsi glyph, so the legend draws one as two strokes.
  function drawTick(p: PDFPage, cx: number, cy: number, s: number) {
    p.drawLine({ start: { x: cx - s * 0.45, y: cy + s * 0.05 }, end: { x: cx - s * 0.12, y: cy - s * 0.35 }, thickness: 1.6, color: NAVY });
    p.drawLine({ start: { x: cx - s * 0.12, y: cy - s * 0.35 }, end: { x: cx + s * 0.5, y: cy + s * 0.45 }, thickness: 1.6, color: NAVY });
  }

  function drawHead(subj: string, continued: boolean) {
    page = pdfDoc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - HEADER_BAND_H, width: W, height: HEADER_BAND_H, color: NAVY });
    page.drawRectangle({ x: 0, y: H - HEADER_BAND_H - 4, width: W, height: 4, color: GOLD });

    const d = logoImg.scale(1);
    const lw = 104, lh = (d.height / d.width) * lw;
    page.drawImage(logoImg, { x: MARGIN, y: H - HEADER_BAND_H / 2 - lh / 2, width: lw, height: lh });

    const title = 'ATTENDANCE SHEET';
    page.drawText(title, { x: W - MARGIN - bold.widthOfTextAtSize(title, 19), y: H - 32, size: 19, font: bold, color: WHITE });
    const sub = 'Level 1 Examination';
    page.drawText(sub, { x: W - MARGIN - font.widthOfTextAtSize(sub, 9), y: H - 46, size: 9, font, color: SUBTITLE });

    y = H - HEADER_BAND_H - 4 - 16;

    const metaH = 46;
    const c3 = 150, c2 = 96, c1 = TABLE_W - c2 - c3;
    page.drawRectangle({ x: MARGIN, y: y - metaH, width: TABLE_W, height: metaH, color: META_BG, borderColor: GRID, borderWidth: 0.8 });
    page.drawLine({ start: { x: MARGIN + c1, y }, end: { x: MARGIN + c1, y: y - metaH }, thickness: 0.8, color: GRID });
    page.drawLine({ start: { x: MARGIN + c1 + c2, y }, end: { x: MARGIN + c1 + c2, y: y - metaH }, thickness: 0.8, color: GRID });

    page.drawText('SCHOOL', { x: MARGIN + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
    let ny = y - 27;
    for (const ln of wrapToWidth(fullName, bold, 10, c1 - 20, 2)) {
      page.drawText(ln, { x: MARGIN + 10, y: ny, size: 10, font: bold, color: INK });
      ny -= 11.5;
    }
    page.drawText('SCHOOL CODE', { x: MARGIN + c1 + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
    page.drawText(code, { x: MARGIN + c1 + 10, y: y - 32, size: 16, font: bold, color: NAVY });
    // Left blank on purpose: Slot 1 and Slot 2 schools sit on different dates.
    page.drawText('DATE / SESSION', { x: MARGIN + c1 + c2 + 10, y: y - 14, size: 7.5, font: bold, color: MUTED });
    page.drawLine({ start: { x: MARGIN + c1 + c2 + 10, y: y - 33 }, end: { x: MARGIN + TABLE_W - 10, y: y - 33 }, thickness: 0.8, color: GRID });

    y -= metaH + 14;

    const sLabel = sanitize(`${SUBJECT_FULL[subj] ?? subj} (${subj})`);
    page.drawText(sLabel, { x: MARGIN, y: y - 12, size: 12.5, font: bold, color: NAVY });
    if (continued) {
      const c = 'continued';
      page.drawText(c, { x: W - MARGIN - font.widthOfTextAtSize(c, 10), y: y - 11, size: 10, font, color: MUTED });
    }
    page.drawLine({ start: { x: MARGIN, y: y - 19 }, end: { x: W - MARGIN, y: y - 19 }, thickness: 2, color: GOLD });
    y -= 19 + 14;
  }

  function drawClassBand(label: string, continued: boolean) {
    page.drawRectangle({ x: MARGIN, y: y - CLASS_BAND_H, width: TABLE_W, height: CLASS_BAND_H, color: CLASS_BG });
    page.drawRectangle({ x: MARGIN, y: y - CLASS_BAND_H, width: 4, height: CLASS_BAND_H, color: GOLD });
    page.drawText(`Class ${label}${continued ? '  (contd.)' : ''}`, { x: MARGIN + 14, y: y - CLASS_BAND_H + 7, size: 11, font: bold, color: NAVY });
    y -= CLASS_BAND_H;
  }

  function drawTableHead() {
    page.drawRectangle({ x: MARGIN, y: y - HEAD_H, width: TABLE_W, height: HEAD_H, color: NAVY });
    for (const c of COL) {
      const centred = c.key === 'sno' || c.key === 'mark';
      const tw = bold.widthOfTextAtSize(c.label, 9);
      page.drawText(c.label, { x: centred ? c.x + c.w / 2 - tw / 2 : c.x + 8, y: y - HEAD_H + 8, size: 9, font: bold, color: WHITE });
    }
    y -= HEAD_H;
  }

  function closeTableFrame(tableTop: number) {
    for (const c of COL.slice(1)) {
      page.drawLine({ start: { x: c.x, y: tableTop }, end: { x: c.x, y }, thickness: 0.6, color: GRID });
    }
    page.drawRectangle({ x: MARGIN, y, width: TABLE_W, height: tableTop - y, borderColor: GRID, borderWidth: 0.8 });
  }

  // Per-class counts, so each exam room reconciles its own numbers even though
  // several classes may share a page.
  function drawClassTotals(total: number) {
    page.drawRectangle({ x: MARGIN, y: y - TOTALS_H, width: TABLE_W, height: TOTALS_H, color: BOX_BG, borderColor: GRID, borderWidth: 0.8 });
    let cx = MARGIN + 12;
    for (const [lab, val] of [['TOTAL', String(total)], ['PRESENT', ''], ['ABSENT', '']] as const) {
      page.drawText(lab, { x: cx, y: y - 15, size: 7.5, font: bold, color: MUTED });
      page.drawRectangle({ x: cx + 46, y: y - TOTALS_H + 5, width: 36, height: 14, color: WHITE, borderColor: GRID, borderWidth: 0.8 });
      if (val) page.drawText(val, { x: cx + 46 + 18 - bold.widthOfTextAtSize(val, 9) / 2, y: y - 16, size: 9, font: bold, color: NAVY });
      cx += 112;
    }
    drawTick(page, cx + 6, y - 12, 9);
    page.drawText('= Present', { x: cx + 16, y: y - 15, size: 8, font, color: MUTED });
    page.drawText('A = Absent', { x: cx + 70, y: y - 15, size: 8, font, color: MUTED });
    y -= TOTALS_H + 14;
  }

  function drawSignatures() {
    const sigW = 170;
    y -= 10;
    const labels = ['Invigilator Signature', 'School Coordinator Signature'];
    for (let i = 0; i < labels.length; i++) {
      const sx = MARGIN + i * (TABLE_W - sigW);
      page.drawLine({ start: { x: sx, y }, end: { x: sx + sigW, y }, thickness: 0.8, color: GRID });
      page.drawText(labels[i], { x: sx, y: y - 11, size: 8, font, color: MUTED });
    }
    y -= 26;
  }

  const roomFor = (n: number) => y - n >= FOOTER_LIMIT;

  for (const subj of SUBJECT_ORDER) {
    const cm = bySubject.get(subj)!;
    const classes = CLASS_ORDER.filter((c) => cm.has(c) && cm.get(c)!.length);
    if (!classes.length) continue;

    drawHead(subj, false);

    for (const classCode of classes) {
      const label = CLASS_LABEL[classCode] ?? classCode;
      const list = cm.get(classCode)!;

      // Classes run continuously within a subject: a class starts wherever the
      // previous one ended. Only a band with no room for even one row under it
      // moves to the next page.
      if (!roomFor(CLASS_BAND_H + HEAD_H + ROW_H)) drawHead(subj, true);
      drawClassBand(label, false);
      drawTableHead();

      let tableTop = y;
      let sno = 1;
      for (const st of list) {
        if (!roomFor(ROW_H)) {
          closeTableFrame(tableTop);
          drawHead(subj, true);
          drawClassBand(label, true);
          drawTableHead();
          tableTop = y;
        }
        const rowY = y - ROW_H;
        if (sno % 2 === 0) page.drawRectangle({ x: MARGIN, y: rowY, width: TABLE_W, height: ROW_H, color: ROW_ALT });
        page.drawLine({ start: { x: MARGIN, y: rowY }, end: { x: W - MARGIN, y: rowY }, thickness: 0.6, color: GRID_SOFT });

        const s1 = String(sno);
        page.drawText(s1, { x: COL[0].x + COL[0].w / 2 - font.widthOfTextAtSize(s1, 9.5) / 2, y: rowY + 9, size: 9.5, font, color: INK });
        page.drawText(sanitize(extractRoll(st.registrationNumber)), { x: COL[1].x + 8, y: rowY + 9, size: 10.5, font: bold, color: NAVY });
        page.drawText(sanitize(st.name), { x: COL[2].x + 8, y: rowY + 9, size: 10, font, color: INK });
        page.drawRectangle({ x: COL[3].x + 16, y: rowY + 4, width: COL[3].w - 32, height: ROW_H - 8, color: WHITE, borderColor: GRID, borderWidth: 0.8 });
        y = rowY;
        sno++;
      }
      closeTableFrame(tableTop);
      y -= 10;

      if (!roomFor(TOTALS_H + 14)) drawHead(subj, true);
      drawClassTotals(list.length);
    }

    if (!roomFor(40)) drawHead(subj, true);
    drawSignatures();
  }

  if (pages.length === 0) {
    page = pdfDoc.addPage([W, H]);
    pages.push(page);
    page.drawText('No registered students yet.', { x: MARGIN, y: H - 120, size: 12, font, color: MUTED });
  }

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const lab = `Page ${i + 1} of ${pages.length}`;
    p.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: W - MARGIN, y: 44 }, thickness: 0.5, color: GRID_SOFT });
    p.drawText('iPlus Olympiads 2026', { x: MARGIN, y: 30, size: 8.5, font, color: MUTED });
    p.drawText(lab, { x: (W - font.widthOfTextAtSize(lab, 8.5)) / 2, y: 30, size: 8.5, font, color: MUTED });
    const rt = 'Return with answer materials';
    p.drawText(rt, { x: W - MARGIN - font.widthOfTextAtSize(rt, 8.5), y: 30, size: 8.5, font, color: MUTED });
  }

  return pdfDoc.save();
}
