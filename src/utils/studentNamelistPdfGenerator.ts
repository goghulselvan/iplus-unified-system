import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import iplusLogoUrl from '@/assets/iplus-logo.png';

export interface NamelistRow {
  name: string;
  classCode: string; // "01".."08", "14" (LKG), "15" (UKG)
  subject: string; // alphabetical_code, e.g. "EPO"
  registrationNumber: string | null;
}

export interface NamelistInput {
  schoolName: string;
  ssNo: number | string | null;
  schoolCode: string | null; // 6-digit state+district+school block, e.g. "331201"
  rows: NamelistRow[];
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

function extractRoll(regNo: string | null): string {
  if (!regNo) return 'Pending';
  const parts = regNo.split('-');
  return parts.length === 6 ? parts[5] : regNo;
}

const INDIGO = { r: 79 / 255, g: 70 / 255, b: 229 / 255 };
const VIOLET = { r: 124 / 255, g: 58 / 255, b: 237 / 255 };
const TEXT_DARK = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.51);
const CARD_BORDER = rgb(0.87, 0.85, 0.95);
const ROW_SHADE = rgb(0.97, 0.97, 0.99);
const CLASS_BAND = rgb(0.90, 0.89, 0.97);
const SUBJECT_BAND = rgb(0.98, 0.75, 0.14);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const W = 595.28, H = 841.89; // A4 portrait
const MARGIN = 40;
const TABLE_W = 515;
const ROW_H = 20;
const HEADER_ROW_H = 22;
const CLASS_BAND_H = 20;
const SUBJECT_BAND_H = 30;
const FOOTER_LIMIT = 60;

const COLS = [
  { key: 'sno', label: 'S.No', x: MARGIN, w: 40 },
  { key: 'name', label: 'Student Name', x: MARGIN + 40, w: 320 },
  { key: 'roll', label: 'Roll No.', x: MARGIN + 40 + 320, w: TABLE_W - (40 + 320) },
];

/**
 * Generates the branded, subject-sectioned Student Namelist PDF: one section
 * per subject (fresh page each), class sub-groups within, S.No resets per
 * class. Roll number only — Class/Subject are already established by the
 * section/sub-header, matching the 2026-08-19 decision to drop the full
 * compound registration number from what students transcribe onto the OMR.
 */
export async function generateStudentNamelistPdf({ schoolName, ssNo, schoolCode, rows }: NamelistInput): Promise<Uint8Array> {
  const bySubject = new Map<string, Map<string, NamelistRow[]>>();
  for (const subj of SUBJECT_ORDER) bySubject.set(subj, new Map());
  for (const r of rows) {
    const classMap = bySubject.get(r.subject);
    if (!classMap) continue;
    if (!classMap.has(r.classCode)) classMap.set(r.classCode, []);
    classMap.get(r.classCode)!.push(r);
  }
  for (const classMap of bySubject.values()) {
    for (const list of classMap.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await fetch(iplusLogoUrl).then((r) => r.arrayBuffer());
  const logoImg = await pdfDoc.embedPng(logoBytes);

  const fullSchoolName = ssNo != null ? `${schoolName} (SS ${ssNo})` : schoolName;
  const generatedOn = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  function drawTopChrome(page: PDFPage): number {
    const barH = 6, strips = 40, stripW = W / strips;
    for (let i = 0; i < strips; i++) {
      const t = i / (strips - 1);
      const c = rgb(lerp(INDIGO.r, VIOLET.r, t), lerp(INDIGO.g, VIOLET.g, t), lerp(INDIGO.b, VIOLET.b, t));
      page.drawRectangle({ x: i * stripW, y: H - barH, width: stripW + 0.5, height: barH, color: c });
    }
    let y = H - barH - 24;
    const logoDims = logoImg.scale(1);
    const logoW = 130, logoH = (logoDims.height / logoDims.width) * logoW;
    page.drawImage(logoImg, { x: MARGIN, y: y - logoH + 10, width: logoW, height: logoH });

    const title = 'Student Namelist';
    const titleSize = 20;
    const titleW = fontBold.widthOfTextAtSize(title, titleSize);
    page.drawText(title, { x: W - MARGIN - titleW, y: y - 6, size: titleSize, font: fontBold, color: rgb(INDIGO.r, INDIGO.g, INDIGO.b) });
    const dateLine = `Generated ${generatedOn}`;
    const dateW = font.widthOfTextAtSize(dateLine, 9);
    page.drawText(dateLine, { x: W - MARGIN - dateW, y: y - 22, size: 9, font, color: MUTED });
    y -= logoH + 6;

    const bannerH = 54;
    page.drawRectangle({ x: MARGIN, y: y - bannerH, width: TABLE_W, height: bannerH, color: rgb(INDIGO.r, INDIGO.g, INDIGO.b) });
    page.drawText(fullSchoolName, { x: MARGIN + 16, y: y - bannerH / 2 + 4, size: 13, font: fontBold, color: rgb(1, 1, 1) });
    const codeText = schoolCode || '—';
    const codeSize = 30;
    const codeW = fontBold.widthOfTextAtSize(codeText, codeSize);
    const codeLabel = 'SCHOOL CODE';
    const codeLabelW = font.widthOfTextAtSize(codeLabel, 9);
    const codeRight = MARGIN + TABLE_W - 16;
    page.drawText(codeLabel, { x: codeRight - codeLabelW, y: y - 15, size: 9, font: fontBold, color: rgb(0.85, 0.83, 0.98) });
    page.drawText(codeText, { x: codeRight - codeW, y: y - bannerH + 12, size: codeSize, font: fontBold, color: rgb(1, 1, 1) });
    y -= bannerH + 14;
    return y;
  }

  function drawSubjectBand(page: PDFPage, y: number, subj: string, continued: boolean): number {
    page.drawRectangle({ x: MARGIN, y: y - SUBJECT_BAND_H, width: TABLE_W, height: SUBJECT_BAND_H, color: SUBJECT_BAND });
    const label = `${SUBJECT_FULL[subj] ?? subj} (${subj})${continued ? ' — continued' : ''}`;
    page.drawText(label, { x: MARGIN + 12, y: y - SUBJECT_BAND_H + 10, size: 12.5, font: fontBold, color: rgb(0.25, 0.16, 0.02) });
    return y - SUBJECT_BAND_H - 10;
  }

  function drawTableHeader(page: PDFPage, y: number): number {
    page.drawRectangle({ x: MARGIN, y: y - HEADER_ROW_H, width: TABLE_W, height: HEADER_ROW_H, color: rgb(INDIGO.r, INDIGO.g, INDIGO.b) });
    for (const col of COLS) {
      page.drawText(col.label, { x: col.x + 8, y: y - HEADER_ROW_H + 7, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
    }
    return y - HEADER_ROW_H;
  }

  function drawClassBand(page: PDFPage, y: number, classLabel: string, continued: boolean): number {
    page.drawRectangle({ x: MARGIN, y: y - CLASS_BAND_H, width: TABLE_W, height: CLASS_BAND_H, color: CLASS_BAND });
    page.drawText(`Class ${classLabel}${continued ? ' (contd.)' : ''}`, { x: MARGIN + 8, y: y - CLASS_BAND_H + 6, size: 10, font: fontBold, color: rgb(INDIGO.r, INDIGO.g, INDIGO.b) });
    return y - CLASS_BAND_H;
  }

  let page: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  function newPage(subj: string, continued: boolean) {
    page = pdfDoc.addPage([W, H]);
    y = drawTopChrome(page);
    y = drawSubjectBand(page, y, subj, continued);
    y = drawTableHeader(page, y);
    pages.push(page);
  }

  function ensureSpace(subj: string, needed: number, classLabelIfMidClass?: string) {
    if (y - needed < FOOTER_LIMIT) {
      newPage(subj, true);
      if (classLabelIfMidClass) y = drawClassBand(page, y, classLabelIfMidClass, true);
    }
  }

  for (const subj of SUBJECT_ORDER) {
    const classMap = bySubject.get(subj)!;
    const classesWithData = CLASS_ORDER.filter((c) => classMap.has(c) && classMap.get(c)!.length);
    if (classesWithData.length === 0) continue;

    newPage(subj, false);

    for (const classCode of classesWithData) {
      const label = CLASS_LABEL[classCode] ?? classCode;
      ensureSpace(subj, CLASS_BAND_H + ROW_H);
      y = drawClassBand(page, y, label, false);
      let sno = 1;

      for (const student of classMap.get(classCode)!) {
        ensureSpace(subj, ROW_H, label);
        const isEven = sno % 2 === 0;
        if (isEven) page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: TABLE_W, height: ROW_H, color: ROW_SHADE });
        page.drawText(String(sno), { x: COLS[0].x + 8, y: y - ROW_H + 6, size: 9, font, color: TEXT_DARK });
        page.drawText(student.name, { x: COLS[1].x + 8, y: y - ROW_H + 6, size: 9, font, color: TEXT_DARK });
        const roll = extractRoll(student.registrationNumber);
        page.drawText(roll, { x: COLS[2].x + 8, y: y - ROW_H + 6, size: 10.5, font: fontBold, color: rgb(INDIGO.r, INDIGO.g, INDIGO.b) });
        y -= ROW_H;
        sno++;
      }
    }
  }

  if (pages.length === 0) {
    // No enrolled students at all — still produce a valid single-page PDF
    // rather than an empty document, so the download never silently fails.
    page = pdfDoc.addPage([W, H]);
    y = drawTopChrome(page);
    page.drawText('No registered students yet.', { x: MARGIN, y: y - 30, size: 12, font, color: MUTED });
    pages.push(page);
  }

  const totalPages = pages.length;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const label = `Page ${i + 1} of ${totalPages}`;
    const labelW = font.widthOfTextAtSize(label, 9);
    p.drawText(label, { x: (W - labelW) / 2, y: 24, size: 9, font, color: MUTED });
    p.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: W - MARGIN, y: 40 }, thickness: 0.5, color: CARD_BORDER });
    p.drawText('iPlus Olympiads', { x: MARGIN, y: 24, size: 9, font, color: MUTED });
  }

  return pdfDoc.save();
}
