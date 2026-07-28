import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import { numberToWords } from './numberToWords';
import iplusLogoUrl from '@/assets/iplus-logo.png';
import receiptWatermarkUrl from '@/assets/receipt-watermark.png';

const COMPANY_GSTIN = '33AAFCI1730F1Z3';

export interface InvoiceLineItemData {
  itemName: string;
  hsnCode: string | null;
  gstRate: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceData {
  invoiceNumber: number;
  fy: number;
  invoiceDate: Date;
  buyerName: string;
  buyerSsNo?: number | null;
  buyerAddress?: string | null;
  buyerState: string;
  buyerGstin?: string | null;
  paymentMethod: string;
  status: string; // 'unpaid' | 'paid' | 'void'
  lineItems: InvoiceLineItemData[];
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
}

const IVORY = rgb(254 / 255, 248 / 255, 237 / 255);
const INDIGO = { r: 79 / 255, g: 70 / 255, b: 229 / 255 };
const VIOLET = { r: 124 / 255, g: 58 / 255, b: 237 / 255 };
const TEXT_DARK = rgb(0.10, 0.10, 0.18);
const MUTED = rgb(0.42, 0.45, 0.51);
const CARD_BORDER = rgb(0.87, 0.85, 0.95);
const ROW_SHADE = rgb(0.97, 0.97, 0.99);
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

export async function generateInvoice(data: InvoiceData): Promise<Blob> {
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

  const isTn = data.buyerState.trim().toLowerCase() === 'tamil nadu';
  const invoiceNo = `INV/${data.fy}-${data.fy + 1}/${data.invoiceNumber}`;
  const dateStr = format(data.invoiceDate, 'dd-MMM-yyyy');

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

  const gstinText = `GSTIN: ${COMPANY_GSTIN}`;
  const gstinW = font.widthOfTextAtSize(gstinText, 9);
  page.drawText(gstinText, { x: W - MARGIN - gstinW, y: H - 30, size: 9, font, color: MUTED });
  const titleText = 'TAX INVOICE';
  const titleW = fontBold.widthOfTextAtSize(titleText, 16);
  page.drawText(titleText, { x: W - MARGIN - titleW, y: H - 48, size: 16, font: fontBold, color: TEXT_DARK });

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
    { label: 'INVOICE NO.', value: invoiceNo },
    { label: 'DATE', value: dateStr },
    { label: 'PAYMENT METHOD', value: data.paymentMethod },
    { label: 'STATUS', value: data.status.toUpperCase() },
  ];
  meta.forEach((m, i) => {
    const x = MARGIN + i * colWMeta;
    page.drawText(m.label, { x, y: metaLabelY, size: 7.5, font: fontBold, color: MUTED });
    page.drawText(String(m.value), { x, y: metaValueY, size: 10.5, font: fontBold, color: TEXT_DARK });
  });

  const divider2Y = metaValueY - 14;
  page.drawLine({ start: { x: MARGIN, y: divider2Y }, end: { x: W - MARGIN, y: divider2Y }, thickness: 0.75, color: CARD_BORDER });

  let by = divider2Y - 18;
  page.drawText('BILL TO', { x: MARGIN, y: by, size: 7.5, font: fontBold, color: MUTED });
  by -= 16;
  const nameLines = splitTextIntoLines(sanitizeForPdf(data.buyerName), fontBold, 13, W - 2 * MARGIN);
  for (const line of nameLines) {
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
  page.drawText(sanitizeForPdf(data.buyerState), { x: MARGIN, y: by, size: 9, font, color: MUTED });
  by -= 12;
  if (data.buyerGstin) {
    page.drawText(`GSTIN: ${sanitizeForPdf(data.buyerGstin)}`, { x: MARGIN, y: by, size: 9, font, color: MUTED });
    by -= 12;
  }

  const tableTop = by - 14;
  const cols = [
    { key: 'sno', label: 'S.No', w: 32 },
    { key: 'item', label: 'Item', w: 190 },
    { key: 'hsn', label: 'HSN/SAC', w: 70 },
    { key: 'qty', label: 'Qty', w: 40 },
    { key: 'price', label: 'Unit Price', w: 80 },
    { key: 'total', label: 'Total', w: 103 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const colX: number[] = [];
  { let x = MARGIN; for (const c of cols) { colX.push(x); x += c.w; } }

  let rowFontSize = 9;
  const rowH = 18;
  const maxTableH = tableTop - 170;
  if (data.lineItems.length * rowH > maxTableH) {
    rowFontSize = Math.max(6.5, 9 * (maxTableH / (data.lineItems.length * rowH)));
  }
  const actualRowH = Math.max(14, rowFontSize + 8);

  page.drawRectangle({ x: MARGIN, y: tableTop - 16, width: tableW, height: 16, color: rgb(0.94, 0.93, 0.98) });
  cols.forEach((c, i) => {
    page.drawText(c.label, { x: colX[i] + 4, y: tableTop - 12, size: 8, font: fontBold, color: TEXT_DARK });
  });

  let rowY = tableTop - 16;
  data.lineItems.forEach((item, idx) => {
    rowY -= actualRowH;
    if (idx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: rowY, width: tableW, height: actualRowH, color: ROW_SHADE });
    }
    const textY = rowY + actualRowH / 2 - rowFontSize / 2.6;
    page.drawText(String(idx + 1), { x: colX[0] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    const itemLines = splitTextIntoLines(sanitizeForPdf(item.itemName), font, rowFontSize, cols[1].w - 8);
    const displayName = itemLines.length > 1
      ? itemLines[0].replace(/\s*\S*$/, '') + '…'
      : itemLines[0];
    page.drawText(displayName, { x: colX[1] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(sanitizeForPdf(item.hsnCode || '—'), { x: colX[2] + 4, y: textY, size: rowFontSize, font, color: MUTED });
    page.drawText(String(item.quantity), { x: colX[3] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(fmtINR(item.unitPrice), { x: colX[4] + 4, y: textY, size: rowFontSize, font, color: TEXT_DARK });
    page.drawText(fmtINR(item.lineTotal), { x: colX[5] + 4, y: textY, size: rowFontSize, font: fontBold, color: TEXT_DARK });
  });

  page.drawLine({ start: { x: MARGIN, y: rowY }, end: { x: MARGIN + tableW, y: rowY }, thickness: 0.75, color: CARD_BORDER });

  let sy = rowY - 20;
  const summaryX = MARGIN + tableW - 200;
  const drawSummaryLine = (label: string, value: string, bold = false) => {
    const f = bold ? fontBold : font;
    const fs = bold ? 11 : 9.5;
    page.drawText(label, { x: summaryX, y: sy, size: fs, font: f, color: bold ? TEXT_DARK : MUTED });
    const vw = f.widthOfTextAtSize(value, fs);
    page.drawText(value, { x: MARGIN + tableW - vw, y: sy, size: fs, font: f, color: TEXT_DARK });
    sy -= bold ? 18 : 14;
  };
  drawSummaryLine('Subtotal', fmtINR(data.subtotal));
  if (isTn) {
    drawSummaryLine('CGST', fmtINR(data.cgstAmount));
    drawSummaryLine('SGST', fmtINR(data.sgstAmount));
  } else {
    drawSummaryLine('IGST', fmtINR(data.igstAmount));
  }
  page.drawLine({ start: { x: summaryX, y: sy + 6 }, end: { x: MARGIN + tableW, y: sy + 6 }, thickness: 0.75, color: CARD_BORDER });
  sy -= 6;
  drawSummaryLine('Grand Total', fmtINR(data.grandTotal), true);

  sy -= 6;
  for (const line of splitTextIntoLines(numberToWords(data.grandTotal), fontItalic, 8.5, W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: sy, size: 8.5, font: fontItalic, color: MUTED });
    sy -= 11;
  }

  const currentDateTime = format(new Date(), 'dd-MMM-yyyy hh:mm a');
  page.drawText(`Computer-generated invoice — no signature required. Generated on ${currentDateTime}`,
    { x: MARGIN, y: 24, size: 7, font: fontItalic, color: MUTED });
  const thanksText = 'Thank you for your purchase with iPlus Olympiads!';
  const thanksW = fontItalic.widthOfTextAtSize(thanksText, 8);
  page.drawText(thanksText, { x: W - MARGIN - thanksW, y: 24, size: 8, font: fontItalic, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
