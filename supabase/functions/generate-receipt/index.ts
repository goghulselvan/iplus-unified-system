// Generates the payment receipt PDF server-side for a payment transaction,
// stores it in the private `receipts` bucket and returns a 7-day signed URL —
// used to attach the receipt to the payment email (Resend fetches the URL)
// and the WhatsApp document-header template (AskEVA/Meta fetches the URL).
// Mirrors the client-side src/utils/receiptGenerator.ts layout exactly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFFont } from "npm:pdf-lib@1.17.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

const COMPANY_GSTIN = "33AAFCI1730F1Z3";

// ── Amount in words (ported from src/utils/numberToWords.ts) ──────────────────
const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];

function under1000(num: number): string {
  if (num === 0) return "";
  let r = "";
  if (num >= 100) { r += ones[Math.floor(num / 100)] + " Hundred "; num %= 100; }
  if (num >= 20) { r += tens[Math.floor(num / 10)] + " "; num %= 10; }
  else if (num >= 10) { return (r + teens[num - 10]).trim(); }
  if (num > 0) r += ones[num] + " ";
  return r.trim();
}

function numberToWords(amount: number): string {
  if (amount === 0) return "Zero Rupees Only";
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let result = "";
  if (rupees > 0) {
    let rem = rupees;
    const parts: string[] = [];
    if (rem >= 10000000) { parts.push(under1000(Math.floor(rem / 10000000)) + " Crore"); rem %= 10000000; }
    if (rem >= 100000) { parts.push(under1000(Math.floor(rem / 100000)) + " Lakh"); rem %= 100000; }
    if (rem >= 1000) { parts.push(under1000(Math.floor(rem / 1000)) + " Thousand"); rem %= 1000; }
    if (rem > 0) parts.push(under1000(rem));
    result = "Rupees " + parts.join(" ");
  }
  if (paise > 0) {
    const pw = under1000(paise);
    result = result ? `${result} and ${pw} Paise` : `${pw} Paise`;
  }
  return result + " Only";
}

function splitLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

const IST_FMT_DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const IST_FMT_DT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
// ICU may emit U+202F (narrow no-break space) before AM/PM — WinAnsi fonts
// cannot encode it, so normalize every exotic space to a plain one.
const plainSpaces = (s: string) => s.replace(/[    ]/g, " ");
const fmtDate = (d: Date) => plainSpaces(IST_FMT_DATE.format(d)).replace(/ /g, "-");
const fmtDateTime = (d: Date) => {
  const s = plainSpaces(IST_FMT_DT.format(d));
  const [datePart, timePart] = s.split(", ");
  return `${datePart.replace(/ /g, "-")} ${(timePart ?? "").toUpperCase()}`;
};
const fmtINR = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Design constants (mirrors src/utils/receiptGenerator.ts exactly) ──────────
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    return await handle(req);
  } catch (e: any) {
    console.error("generate-receipt crashed:", e);
    return json({ error: `generate-receipt failed: ${e?.message ?? e}` }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Only CRM staff may generate receipts (portal school logins share this project)
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isCrm } = await asCaller.rpc("is_crm_user");
  if (!isCrm) return json({ error: "Unauthorized: CRM access required" }, 401);

  let body: { transactionId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const transactionId = body.transactionId;
  if (!transactionId) return json({ error: "transactionId required" }, 400);

  const { data: tx, error: txErr } = await admin
    .from("payment_transactions")
    .select("id, payment_amount, payment_date, payment_mode, transaction_reference, school_id, schools(ss_no, school_name, payment_status, payment_received, outstanding_balance)")
    .eq("id", transactionId)
    .maybeSingle();
  if (txErr || !tx) return json({ error: "Transaction not found" }, 404);

  const { data: rn } = await admin
    .from("receipt_numbers")
    .select("receipt_number, fy")
    .eq("payment_transaction_id", transactionId)
    .maybeSingle();
  if (!rn?.receipt_number) return json({ error: "Receipt number not found for transaction" }, 404);

  const school = (tx as any).schools;
  const receiptNo = `${rn.receipt_number}/${rn.fy}-${rn.fy + 1}`;
  const isPartial = school.payment_status === "Partial";

  // Load logo + watermark from storage
  const { data: logoFile, error: logoErr } = await admin.storage.from("receipts").download("assets/iplus-logo.png");
  if (logoErr || !logoFile) return json({ error: "Receipt logo missing in storage" }, 500);
  const { data: wmFile, error: wmErr } = await admin.storage.from("receipts").download("assets/receipt-watermark.png");
  if (wmErr || !wmFile) return json({ error: "Receipt watermark missing in storage" }, 500);

  const pdfDoc = await PDFDocument.create();
  const W = 595.28, H = 420.94; // A5 landscape — half of an A4 portrait sheet
  const page = pdfDoc.addPage([W, H]);
  const MARGIN = 28;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const logoImg = await pdfDoc.embedPng(await logoFile.arrayBuffer());
  const wmImg = await pdfDoc.embedPng(await wmFile.arrayBuffer());

  const schoolName = String(school.school_name).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const amount = Number(tx.payment_amount);

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
  const titleText = "PAYMENT RECEIPT";
  const titleW = fontBold.widthOfTextAtSize(titleText, 13);
  page.drawText(titleText, { x: W - MARGIN - titleW, y: H - 38, size: 13, font: fontBold, color: TEXT_DARK });

  // 6. Company block — centered, below logo, above divider
  let cy = logoY - 14;
  const companyLines: { t: string; size: number; f: PDFFont }[] = [
    { t: "Ivar Pro Learn for Universal Success Pvt. Ltd.", size: 9.5, f: fontBold },
    { t: "115, GST Road, Guduvancheri, Chennai 603 202", size: 8, f: font },
    { t: "+91 81110 66556  |  contact@iplusedu.in", size: 8, f: font },
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
    { label: "RECEIPT NO.", value: receiptNo },
    { label: "DATE", value: fmtDate(new Date(tx.payment_date)) },
    { label: "PAYMENT MODE", value: tx.payment_mode ?? "—" },
    { label: "PAYMENT REF. NO.", value: tx.transaction_reference || "—" },
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
  page.drawText("RECEIVED FROM", { x: MARGIN + 14, y: ly, size: 7.5, font: fontBold, color: MUTED });
  ly -= 20;
  for (const line of splitLines(schoolName, fontBold, 13, leftW - 28)) {
    page.drawText(line, { x: MARGIN + 14, y: ly, size: 13, font: fontBold, color: TEXT_DARK });
    ly -= 16;
  }
  ly -= 4;
  page.drawText(`SS No: ${school.ss_no}`, { x: MARGIN + 14, y: ly, size: 9.5, font, color: MUTED });

  // Right column — Amount received + status
  let ry = bodyTop - 2;
  page.drawText("AMOUNT RECEIVED", { x: rightX, y: ry, size: 7.5, font: fontBold, color: MUTED });
  ry -= 26;
  page.drawText(fmtINR(amount), { x: rightX, y: ry, size: 21, font: fontBold, color: TEXT_DARK });

  const chipText = isPartial ? "PARTIALLY PAID" : "PAID IN FULL";
  const chipColor = isPartial ? AMBER : GREEN;
  const chipBg = isPartial ? AMBER_BG : GREEN_BG;
  const chipTextW = fontBold.widthOfTextAtSize(chipText, 8);
  const chipPadX = 8, chipH = 15, chipY = ry - 24;
  page.drawRectangle({ x: rightX, y: chipY, width: chipTextW + chipPadX * 2, height: chipH, color: chipBg });
  page.drawText(chipText, { x: rightX + chipPadX, y: chipY + 4.2, size: 8, font: fontBold, color: chipColor });

  let ry2 = chipY - 20;
  if (isPartial) {
    page.drawText("Total Received", { x: rightX, y: ry2, size: 8, font, color: MUTED });
    page.drawText(fmtINR(Number(school.payment_received ?? 0)), { x: rightX + 110, y: ry2, size: 9.5, font: fontBold, color: TEXT_DARK });
    ry2 -= 15;
    page.drawText("Balance Due", { x: rightX, y: ry2, size: 8, font, color: MUTED });
    page.drawText(fmtINR(Number(school.outstanding_balance ?? 0)), { x: rightX + 110, y: ry2, size: 9.5, font: fontBold, color: AMBER });
    ry2 -= 20;
  } else {
    ry2 -= 4;
  }

  for (const line of splitLines(numberToWords(amount), fontItalic, 8.5, rightW)) {
    page.drawText(line, { x: rightX, y: ry2, size: 8.5, font: fontItalic, color: MUTED });
    ry2 -= 11;
  }

  // Footer
  page.drawText(`Computer-generated receipt — no signature required. Generated on ${fmtDateTime(new Date())}`,
    { x: MARGIN, y: 20, size: 7, font: fontItalic, color: MUTED });
  const thanksText = "Thank you for registering with iPlus Olympiads 2026!";
  const thanksW = fontItalic.widthOfTextAtSize(thanksText, 8);
  page.drawText(thanksText, { x: W - MARGIN - thanksW, y: 20, size: 8, font: fontItalic, color: MUTED });

  const pdfBytes = await pdfDoc.save();
  const filename = `Receipt_${rn.receipt_number}_${rn.fy}-${rn.fy + 1}_${school.ss_no}_${schoolName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
  const storagePath = `${rn.fy}/${rn.receipt_number}-${rn.fy}-${rn.fy + 1}-${school.ss_no}.pdf`;

  const { error: upErr } = await admin.storage
    .from("receipts")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return json({ error: `Failed to store receipt: ${upErr.message}` }, 500);

  const { data: signed, error: signErr } = await admin.storage
    .from("receipts")
    .createSignedUrl(storagePath, 7 * 24 * 3600);
  if (signErr || !signed?.signedUrl) return json({ error: "Failed to sign receipt URL" }, 500);

  console.log(`Receipt generated: ${receiptNo} for school SS ${school.ss_no}`);
  return json({ ok: true, receiptNo, url: signed.signedUrl, filename });
}
