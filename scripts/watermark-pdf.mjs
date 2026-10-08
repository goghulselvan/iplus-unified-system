// Stamp a diagonal SAMPLE watermark onto chosen pages of a PDF.
//
// The OMR specimen in the circular is a real, fillable-looking answer sheet. A
// school that prints page 7 and hands it to a child would produce an answer
// sheet the scanner cannot process — the real ones carry registration-specific
// codes. The standalone OMR PDF had a watermark; it was lost when the pages
// were merged into the circular, so this puts it back and keeps it repeatable
// whenever the circular is rebuilt.
//
// Usage: node scripts/watermark-pdf.mjs <in.pdf> <out.pdf> <pageNumbers,1-based>
//   node scripts/watermark-pdf.mjs circular.pdf stamped.pdf 7,8

import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { PDFDocument, rgb, StandardFonts, degrees } =
  require('pdf-lib');

const [, , inPath, outPath, pagesArg] = process.argv;
if (!inPath || !outPath || !pagesArg) {
  console.error('usage: node scripts/watermark-pdf.mjs <in.pdf> <out.pdf> <pages,1-based>');
  process.exit(1);
}
const wanted = new Set(pagesArg.split(',').map(n => parseInt(n.trim(), 10)));

const pdf = await PDFDocument.load(fs.readFileSync(inPath));
const font = await pdf.embedFont(StandardFonts.HelveticaBold);
const pages = pdf.getPages();

const TEXT = 'SAMPLE';
// Light enough to read the form through it, dark enough to survive a
// photocopy — the two failure modes that matter here.
const INK = rgb(0.25, 0.25, 0.30);
const OPACITY = 0.17;
const ANGLE = 38;

let stamped = 0;
for (const [i, page] of pages.entries()) {
  if (!wanted.has(i + 1)) continue;
  const { width, height } = page.getSize();

  // One mark, centred. Three were tried first; Goghul's call after seeing it
  // printed was that the middle one alone is enough and three crowd the form.
  const size = Math.min(width, height) * 0.22;
  const textW = font.widthOfTextAtSize(TEXT, size);
  const rad = (ANGLE * Math.PI) / 180;

  for (const frac of [0.5]) {
    const cx = width / 2;
    const cy = height * frac;
    // drawText anchors at the baseline start, so step back along the rotated
    // axis by half the string to centre it on (cx, cy).
    page.drawText(TEXT, {
      x: cx - (textW / 2) * Math.cos(rad),
      y: cy - (textW / 2) * Math.sin(rad),
      size,
      font,
      color: INK,
      opacity: OPACITY,
      rotate: degrees(ANGLE),
    });
  }
  stamped++;
}

if (stamped === 0) {
  console.error(`no pages matched ${pagesArg} (document has ${pages.length})`);
  process.exit(1);
}
fs.writeFileSync(outPath, await pdf.save());
console.log(`stamped ${stamped} page(s) of ${pages.length} -> ${outPath}`);
