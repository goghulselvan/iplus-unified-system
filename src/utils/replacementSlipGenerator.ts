import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { format } from 'date-fns';
import iplusLogoUrl from '@/assets/iplus-logo.png';
import { shortBookName } from './bookName';

export interface ReplacementSlipData {
  schoolName: string;
  ssNo?: number | null;
  invoiceRefs: string[];
  items: { name: string; quantity: number }[];
}

// A packing slip is printed and handled in the store room — plain white, black
// text, no watermark, so it prints cleanly and nothing competes with the books.
const TEXT_DARK = rgb(0.07, 0.07, 0.10);
const MUTED = rgb(0.40, 0.42, 0.47);
const RULE = rgb(0.80, 0.80, 0.84);
const HEADER_FILL = rgb(0.95, 0.95, 0.96);

function sanitizeForPdf(text: string): string {
  return (text || '')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '?')
    .trim();
}

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

export async function generateReplacementSlip(data: ReplacementSlipData): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const W = 595.28, H = 841.89; // A4 portrait
  const MARGIN = 48;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImg = await pdfDoc.embedPng(await fetch(iplusLogoUrl).then(r => r.arrayBuffer()));

  const QTY_X = W - MARGIN - 60;
  const BOOK_X = MARGIN + 40;

  const drawTableHeader = (page: PDFPage, y: number) => {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: W - 2 * MARGIN, height: 24, color: HEADER_FILL });
    page.drawText('DONE', { x: MARGIN + 6, y, size: 7.5, font: fontBold, color: MUTED });
    page.drawText('BOOK TO PACK', { x: BOOK_X, y, size: 7.5, font: fontBold, color: MUTED });
    page.drawText('QTY', { x: QTY_X + 20, y, size: 7.5, font: fontBold, color: MUTED });
    return y - 30;
  };

  let page = pdfDoc.addPage([W, H]);
  let y = H - MARGIN;

  const logoH = 34, logoW = logoH * (logoImg.width / logoImg.height);
  page.drawImage(logoImg, { x: MARGIN, y: y - logoH, width: logoW, height: logoH });
  const title = 'REPLACEMENT TO SEND';
  page.drawText(title, { x: W - MARGIN - fontBold.widthOfTextAtSize(title, 16), y: y - 16, size: 16, font: fontBold, color: TEXT_DARK });
  const dateText = format(new Date(), 'dd-MMM-yyyy');
  page.drawText(dateText, { x: W - MARGIN - font.widthOfTextAtSize(dateText, 10), y: y - 32, size: 10, font, color: MUTED });
  y -= logoH + 18;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 1, color: RULE });

  y -= 26;
  page.drawText('SEND TO', { x: MARGIN, y, size: 8, font: fontBold, color: MUTED });
  y -= 24;
  for (const line of splitTextIntoLines(sanitizeForPdf(data.schoolName), fontBold, 20, W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y, size: 20, font: fontBold, color: TEXT_DARK });
    y -= 24;
  }
  const subBits: string[] = [];
  if (data.ssNo != null) subBits.push(`SS No ${data.ssNo}`);
  if (data.invoiceRefs.length) subBits.push(`Invoice ${data.invoiceRefs.join(', ')}`);
  if (subBits.length) {
    page.drawText(subBits.join('   |   '), { x: MARGIN, y, size: 10, font, color: MUTED });
    y -= 14;
  }

  y -= 22;
  y = drawTableHeader(page, y);

  const ROW_H = 46;
  for (const item of data.items) {
    if (y - ROW_H < 150) {
      page = pdfDoc.addPage([W, H]);
      y = drawTableHeader(page, H - MARGIN);
    }
    const rowTop = y + 14;
    page.drawRectangle({ x: MARGIN + 6, y: rowTop - 24, width: 18, height: 18, borderColor: TEXT_DARK, borderWidth: 1.2 });
    page.drawText(sanitizeForPdf(shortBookName(item.name)), { x: BOOK_X, y: rowTop - 18, size: 16, font: fontBold, color: TEXT_DARK });
    page.drawText(sanitizeForPdf(item.name), { x: BOOK_X, y: rowTop - 32, size: 8.5, font, color: MUTED });
    const qty = String(item.quantity);
    page.drawText(qty, { x: QTY_X + 40 - fontBold.widthOfTextAtSize(qty, 20), y: rowTop - 20, size: 20, font: fontBold, color: TEXT_DARK });
    y -= ROW_H;
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: W - MARGIN, y: y + 8 }, thickness: 0.5, color: RULE });
  }

  const totalBooks = data.items.reduce((s, i) => s + i.quantity, 0);
  y -= 8;
  const totalText = `Total books: ${totalBooks}`;
  page.drawText(totalText, { x: W - MARGIN - fontBold.widthOfTextAtSize(totalText, 12), y, size: 12, font: fontBold, color: TEXT_DARK });

  const sigY = 96;
  const sigW = (W - 2 * MARGIN - 40) / 3;
  ['Packed by', 'Checked by', 'Date sent'].forEach((label, i) => {
    const x = MARGIN + i * (sigW + 20);
    page.drawLine({ start: { x, y: sigY }, end: { x: x + sigW, y: sigY }, thickness: 0.75, color: TEXT_DARK });
    page.drawText(label, { x, y: sigY - 14, size: 9, font, color: MUTED });
  });

  page.drawText(`Generated ${format(new Date(), 'dd-MMM-yyyy hh:mm a')}`, { x: MARGIN, y: 30, size: 7, font, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
