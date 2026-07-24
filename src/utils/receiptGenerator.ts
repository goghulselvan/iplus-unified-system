import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import { numberToWords } from './numberToWords';
import iplusLogoUrl from '@/assets/iplus-logo.png';
import receiptWatermarkUrl from '@/assets/receipt-watermark.png';

const COMPANY_GSTIN = '33AAFCI1730F1Z3';

interface ReceiptData {
  receiptNumber: number;
  fy: number; // Indian financial year prefix (26 = FY 2026-27, resets each Apr 1)
  ssNo: number;
  schoolName: string;
  paymentDate: Date;
  amount: number;
  paymentMode: string;
  transactionReference?: string | null;
  isPartial?: boolean;
  totalReceived?: number;
  balanceDue?: number;
}

const IVORY = rgb(254 / 255, 248 / 255, 237 / 255);
const INDIGO = { r: 79 / 255, g: 70 / 255, b: 229 / 255 };
const VIOLET = { r: 124 / 255, g: 58 / 255, b: 237 / 255 };
const TEXT_DARK = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.51);
const CARD_BORDER = rgb(0.87, 0.85, 0.95);
const GREEN = rgb(0.06, 0.55, 0.35);
const GREEN_BG = rgb(0.86, 0.96, 0.90);
const AMBER = rgb(0.72, 0.45, 0.03);
const AMBER_BG = rgb(1, 0.95, 0.82);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function splitTextIntoLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(testLine, fontSize) <= maxWidth) currentLine = testLine;
    else { if (currentLine) lines.push(currentLine); currentLine = word; }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [text];
}

const fmtINR = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateReceipt(data: ReceiptData): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const W = 595.28, H = 420.94; // A5 landscape — half of an A4 portrait sheet
  const page = pdfDoc.addPage([W, H]);
  const MARGIN = 28;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const logoBytes = await fetch(iplusLogoUrl).then(r => r.arrayBuffer());
  const logoImg = await pdfDoc.embedPng(logoBytes);
  const wmBytes = await fetch(receiptWatermarkUrl).then(r => r.arrayBuffer());
  const wmImg = await pdfDoc.embedPng(wmBytes);

  const sanitizedSchoolName = data.schoolName.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const receiptNo = `${data.receiptNumber}/${data.fy}-${data.fy + 1}`;
  const dateStr = format(data.paymentDate, 'dd-MMM-yyyy');

  // 1. Background
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: IVORY });

  // 2. Watermark — centered, low opacity
  const wmH = 300, wmW = wmH * (wmImg.width / wmImg.height);
  page.drawImage(wmImg, { x: (W - wmW) / 2, y: (H - wmH) / 2, width: wmW, height: wmH, opacity: 0.07 });

  // 3. Top accent gradient bar (indigo -> violet)
  const barH = 7, STRIPS = 80, stripW = W / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const t = i / (STRIPS - 1);
    const c = rgb(lerp(INDIGO.r, VIOLET.r, t), lerp(INDIGO.g, VIOLET.g, t), lerp(INDIGO.b, VIOLET.b, t));
    page.drawRectangle({ x: i * stripW, y: H - barH, width: stripW + 0.5, height: barH, color: c });
  }

  // 4. Header logo — centered
  const logoH = 34, logoW = logoH * (logoImg.width / logoImg.height);
  const logoY = H - barH - 12 - logoH;
  page.drawImage(logoImg, { x: (W - logoW) / 2, y: logoY, width: logoW, height: logoH });

  // 5. GSTIN + title, top-right, stacked
  const gstinText = `GSTIN: ${COMPANY_GSTIN}`;
  const gstinW = font.widthOfTextAtSize(gstinText, 8);
  page.drawText(gstinText, { x: W - MARGIN - gstinW, y: H - 22, size: 8, font, color: MUTED });
  const titleText = 'PAYMENT RECEIPT';
  const titleW = fontBold.widthOfTextAtSize(titleText, 13);
  page.drawText(titleText, { x: W - MARGIN - titleW, y: H - 38, size: 13, font: fontBold, color: TEXT_DARK });

  // 6. Company block — centered, below logo, above divider
  let cy = logoY - 14;
  const companyLines: { t: string; size: number; f: PDFFont }[] = [
    { t: 'Ivar Pro Learn for Universal Success Pvt. Ltd.', size: 9.5, f: fontBold },
    { t: '115, GST Road, Guduvancheri, Chennai 603 202', size: 8, f: font },
    { t: '+91 81110 66556  |  contact@iplusedu.in', size: 8, f: font },
  ];
  for (const line of companyLines) {
    const w = line.f.widthOfTextAtSize(line.t, line.size);
    page.drawText(line.t, { x: (W - w) / 2, y: cy, size: line.size, font: line.f, color: line.f === fontBold ? TEXT_DARK : MUTED });
    cy -= 11;
  }

  // 7. Divider
  const dividerY = cy - 6;
  page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: W - MARGIN, y: dividerY }, thickness: 0.75, color: CARD_BORDER });

  // 8. Meta row — 4 columns
  const metaLabelY = dividerY - 16, metaValueY = dividerY - 30;
  const colW = (W - 2 * MARGIN) / 4;
  const meta = [
    { label: 'RECEIPT NO.', value: receiptNo },
    { label: 'DATE', value: dateStr },
    { label: 'PAYMENT MODE', value: data.paymentMode },
    { label: 'PAYMENT REF. NO.', value: data.transactionReference || '—' },
  ];
  meta.forEach((m, i) => {
    const x = MARGIN + i * colW;
    page.drawText(m.label, { x, y: metaLabelY, size: 7.5, font: fontBold, color: MUTED });
    page.drawText(String(m.value), { x, y: metaValueY, size: 11, font: fontBold, color: TEXT_DARK });
  });

  // 9. Second divider
  const divider2Y = metaValueY - 12;
  page.drawLine({ start: { x: MARGIN, y: divider2Y }, end: { x: W - MARGIN, y: divider2Y }, thickness: 0.75, color: CARD_BORDER });

  // 10. Two-column body
  const bodyTop = divider2Y - 16;
  const cardH = 116;
  const leftW = 250, rightX = MARGIN + leftW + 18, rightW = W - MARGIN - rightX;

  // Left card — Received From (55% opacity so the watermark shows through)
  page.drawRectangle({ x: MARGIN, y: bodyTop - cardH, width: leftW, height: cardH, color: rgb(1, 1, 1), opacity: 0.55, borderColor: CARD_BORDER, borderWidth: 1 });
  let ly = bodyTop - 20;
  page.drawText('RECEIVED FROM', { x: MARGIN + 14, y: ly, size: 7.5, font: fontBold, color: MUTED });
  ly -= 20;
  for (const line of splitTextIntoLines(sanitizedSchoolName, fontBold, 13, leftW - 28)) {
    page.drawText(line, { x: MARGIN + 14, y: ly, size: 13, font: fontBold, color: TEXT_DARK });
    ly -= 16;
  }
  ly -= 4;
  page.drawText(`SS No: ${data.ssNo}`, { x: MARGIN + 14, y: ly, size: 9.5, font, color: MUTED });

  // Right column — Amount received + status
  let ry = bodyTop - 2;
  page.drawText('AMOUNT RECEIVED', { x: rightX, y: ry, size: 7.5, font: fontBold, color: MUTED });
  ry -= 26;
  page.drawText(fmtINR(data.amount), { x: rightX, y: ry, size: 21, font: fontBold, color: TEXT_DARK });

  const isPartial = !!data.isPartial;
  const chipText = isPartial ? 'PARTIALLY PAID' : 'PAID IN FULL';
  const chipColor = isPartial ? AMBER : GREEN;
  const chipBg = isPartial ? AMBER_BG : GREEN_BG;
  const chipTextW = fontBold.widthOfTextAtSize(chipText, 8);
  const chipPadX = 8, chipH = 15, chipY = ry - 24;
  page.drawRectangle({ x: rightX, y: chipY, width: chipTextW + chipPadX * 2, height: chipH, color: chipBg });
  page.drawText(chipText, { x: rightX + chipPadX, y: chipY + 4.2, size: 8, font: fontBold, color: chipColor });

  let ry2 = chipY - 20;
  if (isPartial) {
    page.drawText('Total Received', { x: rightX, y: ry2, size: 8, font, color: MUTED });
    page.drawText(fmtINR(data.totalReceived ?? 0), { x: rightX + 110, y: ry2, size: 9.5, font: fontBold, color: TEXT_DARK });
    ry2 -= 15;
    page.drawText('Balance Due', { x: rightX, y: ry2, size: 8, font, color: MUTED });
    page.drawText(fmtINR(data.balanceDue ?? 0), { x: rightX + 110, y: ry2, size: 9.5, font: fontBold, color: AMBER });
    ry2 -= 20;
  } else {
    ry2 -= 4;
  }

  for (const line of splitTextIntoLines(numberToWords(data.amount), fontItalic, 8.5, rightW)) {
    page.drawText(line, { x: rightX, y: ry2, size: 8.5, font: fontItalic, color: MUTED });
    ry2 -= 11;
  }

  // Footer
  const currentDateTime = format(new Date(), 'dd-MMM-yyyy hh:mm a');
  page.drawText(`Computer-generated receipt — no signature required. Generated on ${currentDateTime}`,
    { x: MARGIN, y: 20, size: 7, font: fontItalic, color: MUTED });
  const thanksText = 'Thank you for registering with iPlus Olympiads 2026!';
  const thanksW = fontItalic.widthOfTextAtSize(thanksText, 8);
  page.drawText(thanksText, { x: W - MARGIN - thanksW, y: 20, size: 8, font: fontItalic, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
