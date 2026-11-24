import JSZip from 'jszip';

/**
 * Reads the OMR operator's export (.xlsx or .csv): a "Roll Number" column and Q1..Qn
 * columns, one row per answer sheet. Cells go to the server as read; the server checks
 * every value and decides which paper each row belongs to. Row numbers are the
 * spreadsheet's own (header = row 1), so staff can find them in Excel.
 */
export interface OmrRow { row: number; reg: string; values: (string | null)[] }
export interface OmrFileError { row: number; message: string }

const norm = (s: string) => s.toLowerCase().replace(/[\s_.]+/g, ' ').trim();
const ROLL_HEADERS = new Set(['roll number', 'roll no', 'rollno', 'registration number', 'reg no']);

export function parseOmrTable(table: string[][]): { rows: OmrRow[]; errors: OmrFileError[] } {
  const headerAt = table.findIndex((r) => r.some((c) => ROLL_HEADERS.has(norm(c ?? ''))));
  if (headerAt < 0) {
    return { rows: [], errors: [{ row: 1, message: 'The file needs a "Roll Number" column in the heading row' }] };
  }
  const header = table[headerAt];
  const regCol = header.findIndex((c) => ROLL_HEADERS.has(norm(c ?? '')));
  const qCol = new Map<number, number>();
  header.forEach((h, i) => {
    const m = /^q\s*0*(\d+)$/i.exec((h ?? '').trim());
    if (m && !qCol.has(+m[1])) qCol.set(+m[1], i);
  });
  let last = 0;
  while (qCol.has(last + 1)) last++;
  if (last === 0) {
    return { rows: [], errors: [{ row: headerAt + 1, message: 'The file has no question columns (Q1, Q2, …) in the heading row' }] };
  }

  const rows: OmrRow[] = [];
  for (let r = headerAt + 1; r < table.length; r++) {
    const rec = table[r] ?? [];
    if (rec.every((c) => (c ?? '').trim() === '')) continue;
    const values: (string | null)[] = [];
    for (let q = 1; q <= last; q++) {
      const v = (rec[qCol.get(q)!] ?? '').trim();
      values.push(v === '' ? null : v);
    }
    rows.push({ row: r + 1, reg: (rec[regCol] ?? '').trim(), values });
  }
  if (rows.length === 0) return { rows, errors: [{ row: headerAt + 2, message: 'The file has no student rows' }] };
  return { rows, errors: [] };
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

/** Text of every <t> inside a fragment (rich-text runs are joined). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** First worksheet of an .xlsx as a grid of display strings. */
export async function readXlsxTable(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(data);
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!wb || !rels) throw new Error('This is not a readable Excel file. Save it again as .xlsx and choose it again.');
  const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  const target = firstRid ? new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`).exec(rels)?.[1] : undefined;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = await zip.file(path)?.async('string');
  if (!sheet) throw new Error('This Excel file has no sheet we can read.');
  const ssXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const shared = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const table: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rNum = +(/\br="(\d+)"/.exec(rm[1])?.[1] ?? table.length + 1);
    const cells: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[+(v ?? -1)] ?? '';
      else if (type === 'inlineStr') text = textOf(body);
      else if (v !== undefined) text = unescapeXml(v);
      cells[ref ? colIndex(ref) : cells.length] = text;
    }
    table[rNum - 1] = Array.from(cells, (c) => c ?? '');
  }
  return Array.from(table, (r) => r ?? []);
}

/** Minimal CSV grid (quoted fields, escaped quotes, CRLF/LF). */
export function readCsvTable(text: string): string[][] {
  const out: string[][] = [];
  let rec: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rec.push(field); out.push(rec); rec = []; field = '';
    } else field += c;
  }
  if (field !== '' || rec.length) { rec.push(field); out.push(rec); }
  return out;
}

export async function readOmrFile(file: File): Promise<{ rows: OmrRow[]; errors: OmrFileError[] }> {
  if (/\.xlsx$/i.test(file.name)) return parseOmrTable(await readXlsxTable(await file.arrayBuffer()));
  if (/\.csv$/i.test(file.name)) return parseOmrTable(readCsvTable(await file.text()));
  return { rows: [], errors: [{ row: 0, message: 'Please choose the OMR file as .xlsx or .csv.' }] };
}
