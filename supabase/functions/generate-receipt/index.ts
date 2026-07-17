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
const plainSpaces = (s: string) => s.replace(/[\u202f\u00a0\u2009\u2007]/g, " ");
const fmtDate = (d: Date) => plainSpaces(IST_FMT_DATE.format(d)).replace(/ /g, "-");
const fmtDateTime = (d: Date) => {
  const s = plainSpaces(IST_FMT_DT.format(d)); // "17 Jul 2026, 10:05 pm"
  const [datePart, timePart] = s.split(", ");
  return `${datePart.replace(/ /g, "-")} ${(timePart ?? "").toUpperCase()}`;
};

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
    .select("id, payment_amount, payment_date, school_id, schools(ss_no, school_name)")
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
  const receiptNo = `${rn.fy}-${rn.receipt_number}-${String(school.ss_no).padStart(4, "0")}`;

  // Load the blank receipt template from storage
  const { data: tpl, error: tplErr } = await admin.storage
    .from("receipts")
    .download("template/receipt-template.pdf");
  if (tplErr || !tpl) return json({ error: "Receipt template missing in storage" }, 500);

  const pdfDoc = await PDFDocument.load(await tpl.arrayBuffer());
  const page = pdfDoc.getPages()[0];
  const { height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const schoolName = String(school.school_name).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const amount = Number(tx.payment_amount);
  const now = new Date();
  const CM = 28.35;
  const black = rgb(0, 0, 0);

  // Same coordinates as src/utils/receiptGenerator.ts
  page.drawText(receiptNo, { x: 5 * CM, y: height - 7.75 * CM, size: 12, font: fontBold, color: black });
  page.drawText(fmtDate(new Date(tx.payment_date)), { x: 16 * CM, y: height - 7.75 * CM, size: 12, font, color: black });
  // 300pt max: lines start at x=9.5cm (269pt) on a 595pt page — 400 overflowed
  splitLines(schoolName, fontBold, 13, 300).forEach((line, i) => {
    page.drawText(line, { x: (i === 0 ? 9.5 : 10.5) * CM, y: height - (9.25 + i * 0.5) * CM, size: 13, font: fontBold, color: black });
  });
  page.drawText(`Rs. ${amount.toFixed(2)}`, { x: 9.5 * CM, y: height - 11.25 * CM, size: 13, font: fontBold, color: black });
  splitLines(numberToWords(amount), font, 13, 300).forEach((line, i) => {
    page.drawText(line, { x: (i === 0 ? 9.5 : 10.5) * CM, y: height - (12.5 + i * 0.5) * CM, size: 13, font, color: black });
  });
  page.drawText(fmtDateTime(now), { x: 14.7 * CM, y: height - 16 * CM, size: 10, font, color: black });

  const pdfBytes = await pdfDoc.save();
  const filename = `Receipt_${receiptNo}_${schoolName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
  const storagePath = `${rn.fy}/${receiptNo}.pdf`;

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
