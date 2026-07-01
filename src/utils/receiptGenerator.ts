import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { format } from 'date-fns';
import { numberToWords } from './numberToWords';

interface ReceiptData {
  receiptNumber: number;
  ssNo: number;
  schoolName: string;
  paymentDate: Date;
  amount: number;
}

// Helper function to split text into lines based on maxWidth
function splitTextIntoLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.length > 0 ? lines : [text];
}

export async function generateReceipt(data: ReceiptData): Promise<Blob> {
  // Load the template PDF
  const templateUrl = '/receipt-template.pdf';
  const templateBytes = await fetch(templateUrl).then(res => res.arrayBuffer());
  
  // Load the PDF template
  const pdfDoc = await PDFDocument.load(templateBytes);
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  
  // Get page dimensions
  const { width, height } = firstPage.getSize();
  
  // Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Sanitize school name - replace newlines and extra whitespace
  const sanitizedSchoolName = data.schoolName
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Format data
  const receiptNo = `${data.receiptNumber}-${String(data.ssNo).padStart(4, '0')}`;
  const dateStr = format(data.paymentDate, 'dd-MMM-yyyy');
  const amountStr = `Rs. ${data.amount.toFixed(2)}`;
  const amountInWords = numberToWords(data.amount);
  const currentDateTime = format(new Date(), 'dd-MMM-yyyy hh:mm a');
  const footerText = `No need of Signature since this Receipt is computer generated on ${currentDateTime}`;
  
  // A4 dimensions: 595.28 x 841.89 points (or 210mm x 297mm)
  // Y coordinates in pdf-lib start from BOTTOM, not top
  // Conversion: 1cm = 28.35 points, Y from bottom = height - Y from top
  
  // Receipt No: 5cm from left, 7.75cm from top (lowered by 0.25cm)
  firstPage.drawText(receiptNo, {
    x: 5 * 28.35, // 5cm from left = 141.75 points
    y: height - (7.75 * 28.35), // 7.75cm from top
    size: 12,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  // Date: 16cm from left, 7.75cm from top (lowered by 0.25cm)
  firstPage.drawText(dateStr, {
    x: 16 * 28.35, // 16cm from left = 453.6 points
    y: height - (7.75 * 28.35), // 7.75cm from top
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
  });
  
  // School Name: 9.5cm from left, 9.25cm from top (lowered by 0.25cm, second line at 10.5cm)
  const schoolNameLines = splitTextIntoLines(sanitizedSchoolName, fontBold, 13, 400);
  schoolNameLines.forEach((line, index) => {
    firstPage.drawText(line, {
      x: (index === 0 ? 9.5 : 10.5) * 28.35, // First line at 9.5cm, subsequent at 10.5cm
      y: height - ((9.25 + index * 0.5) * 28.35), // 9.25cm from top, 0.5cm line height
      size: 13,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
  });
  
  // Amount: 9.5cm from left, 11.25cm from top (raised by 0.25cm)
  firstPage.drawText(amountStr, {
    x: 9.5 * 28.35, // 9.5cm from left
    y: height - (11.25 * 28.35), // 11.25cm from top
    size: 13,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  
  // Amount in words: 9.5cm from left, 12.5cm from top (raised by 0.5cm, second line at 10.5cm)
  const amountInWordsLines = splitTextIntoLines(amountInWords, font, 13, 400);
  amountInWordsLines.forEach((line, index) => {
    firstPage.drawText(line, {
      x: (index === 0 ? 9.5 : 10.5) * 28.35, // First line at 9.5cm, subsequent at 10.5cm
      y: height - ((12.5 + index * 0.5) * 28.35), // 12.5cm from top, 0.5cm line height
      size: 13,
      font: font,
      color: rgb(0, 0, 0),
    });
  });
  
  // Date and time only: 14.7cm from left, 16cm from top
  firstPage.drawText(currentDateTime, {
    x: 14.7 * 28.35, // 14.7cm from left
    y: height - (16 * 28.35), // 16cm from top
    size: 10,
    font: font,
    color: rgb(0, 0, 0),
  });
  
  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();
  
  // Return as blob
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
