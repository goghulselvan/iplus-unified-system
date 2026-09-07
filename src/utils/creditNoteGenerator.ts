import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import { numberToWords } from './numberToWords';
import iplusLogoUrl from '@/assets/iplus-logo.png';
import receiptWatermarkUrl from '@/assets/receipt-watermark.png';

export interface CreditNoteData {
  creditNoteNumber: number;
  fy: number;
  issuedDate: Date;
  source: 'return' | 'advance_payment';
  buyerName: string;
  buyerSsNo?: number | null;
  buyerAddress?: string | null;
  buyerState?: string | null;
  amount: number;
  remainingBalance: number;
  note?: string | null;
  paymentMode?: string | null;
  paymentDate?: Date | null;
  paymentReference?: string | null;
}

const IVORY = rgb(254 / 255, 248 / 255, 237 / 255);
const INDIGO = { r: 79 / 255, g: 70 / 255, b: 229 / 255 };
const VIOLET = { r: 124 / 255, g: 58 / 255, b: 237 / 255 };
const TEXT_DARK = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.51);
const CARD_BORDER = rgb(0.87, 0.85, 0.95);
const EMERALD = rgb(4 / 255, 120 / 255, 87 / 255);
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

function sanitizeForPdf(text: string): string {
  return (text || '')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '?')
    .trim();
}

export async function generateCreditNote(data: CreditNoteData): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const W = 595.28, H = 841.89; // A4 portrait
  const page = pdfDoc.addPage([W, H]);
  const MARGIN = 40;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const logoBytes = await fetch(iplusLogoUrl).then(r => r.arrayBuffer());
  const logoImg = await pdfDoc.embedPng(logoBytes);
  const wmBytes = await fetch(receiptWatermarkUrl).then(r => r.arrayBuffer());
  const wmImg = await pdfDoc.embedPng(wmBytes);

  const cnNo = `CN/${data.fy}-${data.fy + 1}/${data.creditNoteNumber}`;
  const used = Math.max(0, data.amount - data.remainingBalance);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: IVORY });

  const wmH = 260, wmW = wmH * (wmImg.width / wmImg.height);
  page.drawImage(wmImg, { x: (W - wmW) / 2, y: (H - wmH) / 2, width: wmW, height: wmH, opacity: 0.05 });

  const barH = 7, STRIPS = 80, stripW = W / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const t = i / (STRIPS - 1);
    const c = rgb(lerp(INDIGO.r, VIOLET.r, t), lerp(INDIGO.g, VIOLET.g, t), lerp(INDIGO.b, VIOLET.b, t));
    page.drawRectangle({ x: i * stripW, y: H - barH, width: stripW + 0.5, height: barH, color: c });
  }

  const logoH = 38, logoW = logoH * (logoImg.width / logoImg.height);
  const logoY = H - barH - 14 - logoH;
  page.drawImage(logoImg, { x: MARGIN, y: logoY, width: logoW, height: logoH });

  const titleText = 'CREDIT NOTE';
  const titleW = fontBold.widthOfTextAtSize(titleText, 16);
  page.drawText(titleText, { x: W - MARGIN - titleW, y: H - 40, size: 16, font: fontBold, color: TEXT_DARK });

  let cy = logoY - 16;
  const sellerLines: { t: string; size: number; f: PDFFont }[] = [
    { t: 'iPlus Olympiads', size: 12, f: fontBold },
    { t: 'by Ivar Pro Learn for Universal Success Pvt. Ltd.', size: 9, f: font },
    { t: '115, GST Road, Guduvancheri, Chennai 603 202', size: 8.5, f: font },
    { t: '+91 81110 66556', size: 8.5, f: font },
  ];
  for (const line of sellerLines) {
    const w = line.f.widthOfTextAtSize(line.t, line.size);
    page.drawText(line.t, { x: (W - w) / 2, y: cy, size: line.size, font: line.f, color: line.f === fontBold ? TEXT_DARK : MUTED });
    cy -= line.size + 4;
  }

  const dividerY = cy - 8;
  page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: W - MARGIN, y: dividerY }, thickness: 0.75, color: CARD_BORDER });

  const metaLabelY = dividerY - 18, metaValueY = dividerY - 32;
  const colWMeta = (W - 2 * MARGIN) / 4;
  const meta = [
    { label: 'CREDIT NOTE NO.', value: cnNo },
    { label: 'DATE', value: format(data.issuedDate, 'dd-MMM-yyyy') },
    { label: 'ORIGIN', value: data.source === 'advance_payment' ? 'ADVANCE PAYMENT' : 'RETURN' },
    { label: 'STATUS', value: data.remainingBalance > 0 ? 'OPEN' : 'FULLY CLAIMED' },
  ];
  meta.forEach((m, i) => {
    const x = MARGIN + i * colWMeta;
    page.drawText(m.label, { x, y: metaLabelY, size: 7.5, font: fontBold, color: MUTED });
    page.drawText(String(m.value), { x, y: metaValueY, size: 10, font: fontBold, color: TEXT_DARK });
  });

  const divider2Y = metaValueY - 14;
  page.drawLine({ start: { x: MARGIN, y: divider2Y }, end: { x: W - MARGIN, y: divider2Y }, thickness: 0.75, color: CARD_BORDER });

  let by = divider2Y - 18;
  page.drawText('ISSUED TO', { x: MARGIN, y: by, size: 7.5, font: fontBold, color: MUTED });
  by -= 16;
  for (const line of splitTextIntoLines(sanitizeForPdf(data.buyerName), fontBold, 13, W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: by, size: 13, font: fontBold, color: TEXT_DARK });
    by -= 16;
  }
  if (data.buyerSsNo != null) {
    page.drawText(`SS No: ${data.buyerSsNo}`, { x: MARGIN, y: by, size: 9, font, color: MUTED });
    by -= 13;
  }
  if (data.buyerAddress) {
    for (const line of splitTextIntoLines(sanitizeForPdf(data.buyerAddress), font, 9, W - 2 * MARGIN)) {
      page.drawText(line, { x: MARGIN, y: by, size: 9, font, color: MUTED });
      by -= 12;
    }
  }
  if (data.buyerState) {
    page.drawText(sanitizeForPdf(data.buyerState), { x: MARGIN, y: by, size: 9, font, color: MUTED });
    by -= 12;
  }

  // Amount panel
  const panelTop = by - 14;
  const panelH = 92;
  page.drawRectangle({ x: MARGIN, y: panelTop - panelH, width: W - 2 * MARGIN, height: panelH, color: rgb(0.94, 0.93, 0.98), borderColor: CARD_BORDER, borderWidth: 0.75 });
  const rowLabel = (label: string, value: string, y: number, bold = false) => {
    const f = bold ? fontBold : font;
    const fs = bold ? 12 : 10;
    page.drawText(label, { x: MARGIN + 14, y, size: fs, font: f, color: bold ? TEXT_DARK : MUTED });
    const vw = f.widthOfTextAtSize(value, fs);
    page.drawText(value, { x: W - MARGIN - 14 - vw, y, size: fs, font: f, color: bold ? EMERALD : TEXT_DARK });
  };
  rowLabel('Credit note value', fmtINR(data.amount), panelTop - 22);
  rowLabel('Already used', used > 0 ? `- ${fmtINR(used)}` : fmtINR(0), panelTop - 44);
  page.drawLine({ start: { x: MARGIN + 14, y: panelTop - 56 }, end: { x: W - MARGIN - 14, y: panelTop - 56 }, thickness: 0.75, color: CARD_BORDER });
  rowLabel('Balance available', fmtINR(data.remainingBalance), panelTop - 76, true);

  let sy = panelTop - panelH - 20;
  for (const line of splitTextIntoLines(numberToWords(data.remainingBalance) + ' available', fontItalic, 8.5, W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: sy, size: 8.5, font: fontItalic, color: MUTED });
    sy -= 11;
  }

  // Payment source (advance payment only)
  if (data.source === 'advance_payment' && (data.paymentMode || data.paymentReference || data.paymentDate)) {
    sy -= 10;
    page.drawText('RECEIVED FROM SCHOOL', { x: MARGIN, y: sy, size: 7.5, font: fontBold, color: MUTED });
    sy -= 14;
    const bits: string[] = [];
    if (data.paymentMode) bits.push(sanitizeForPdf(data.paymentMode));
    if (data.paymentDate) bits.push(format(data.paymentDate, 'dd-MMM-yyyy'));
    if (data.paymentReference) bits.push(`Ref ${sanitizeForPdf(data.paymentReference)}`);
    page.drawText(bits.join('  |  '), { x: MARGIN, y: sy, size: 9.5, font, color: TEXT_DARK });
    sy -= 16;
  }

  if (data.note) {
    sy -= 6;
    page.drawText('NOTE', { x: MARGIN, y: sy, size: 7.5, font: fontBold, color: MUTED });
    sy -= 13;
    for (const line of splitTextIntoLines(sanitizeForPdf(data.note), font, 9, W - 2 * MARGIN)) {
      page.drawText(line, { x: MARGIN, y: sy, size: 9, font, color: MUTED });
      sy -= 12;
    }
  }

  // Assurance box
  sy -= 14;
  const boxH = 58;
  page.drawRectangle({ x: MARGIN, y: sy - boxH, width: W - 2 * MARGIN, height: boxH, color: rgb(0.90, 0.97, 0.94), borderColor: rgb(0.72, 0.90, 0.82), borderWidth: 0.75 });
  const assure = data.remainingBalance > 0
    ? `This credit note confirms a balance of ${fmtINR(data.remainingBalance)} held in your school's favour with iPlus Olympiads. It can be applied against any future book order, or refunded to your school bank account on request. Quote ${cnNo} when placing your next order.`
    : `This credit note (${cnNo}) has been fully claimed. No balance remains.`;
  let ay = sy - 16;
  for (const line of splitTextIntoLines(assure, font, 8.5, W - 2 * MARGIN - 28)) {
    page.drawText(line, { x: MARGIN + 14, y: ay, size: 8.5, font, color: rgb(0.06, 0.36, 0.26) });
    ay -= 11;
  }

  const currentDateTime = format(new Date(), 'dd-MMM-yyyy hh:mm a');
  page.drawText(`Computer-generated credit note - no signature required. Generated on ${currentDateTime}`,
    { x: MARGIN, y: 24, size: 7, font: fontItalic, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
