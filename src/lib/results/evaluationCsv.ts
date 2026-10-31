import { regDigits } from './regNumber';

export interface CsvRow { row: number; reg: string; values: (string | number | null)[] }
export interface CsvError { row: number; message: string }

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF/LF/CR, embedded newlines. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let inQ = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const endField = () => { rec.push(field); field = ''; };
  const endRec = () => { endField(); records.push(rec); rec = []; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') endField();
    else if (c === '\r') { if (text[i + 1] === '\n') i++; endRec(); }
    else if (c === '\n') endRec();
    else field += c;
  }
  if (field !== '' || rec.length > 0) endRec();
  return records;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim();
const REG_HEADERS = new Set(['registration number', 'reg no', 'roll no']);

function questionIndex(h: string): number | null {
  const m = /^q?\s*0*(\d+)$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : null;
}

export function parseEvaluationCsv(
  text: string,
  mode: 'manual' | 'omr',
  totalQuestions: number,
): { rows: CsvRow[]; errors: CsvError[] } {
  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  const records = parseCsv(text);
  if (records.length === 0) {
    return { rows, errors: [{ row: 1, message: 'The file is empty' }] };
  }
  const header = records[0];
  const regCol = header.findIndex(h => REG_HEADERS.has(norm(h)));
  if (regCol < 0) {
    return {
      rows,
      errors: [{ row: 1, message: 'The file needs a "registration_number" column in the first row' }],
    };
  }
  const qCol = new Map<number, number>(); // question number -> column
  header.forEach((h, idx) => {
    const q = questionIndex(h);
    if (q !== null && idx !== regCol && !qCol.has(q)) qCol.set(q, idx);
  });
  const missing: number[] = [];
  for (let q = 1; q <= totalQuestions; q++) if (!qCol.has(q)) missing.push(q);
  if (missing.length > 0) {
    return {
      rows,
      errors: [{
        row: 1,
        message: `The file has ${qCol.size} question columns; this paper has ${totalQuestions} questions`,
      }],
    };
  }

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.every(c => c.trim() === '')) continue;
    const row = r + 1;
    const reg = regDigits(rec[regCol] ?? '');
    if (!reg) { errors.push({ row, message: `Row ${row} has no registration number` }); continue; }
    const values: (string | number | null)[] = [];
    let bad = false;
    for (let q = 1; q <= totalQuestions; q++) {
      const raw = (rec[qCol.get(q)!] ?? '').trim();
      if (raw === '') { values.push(null); continue; }
      if (mode === 'omr') {
        const v = raw.toUpperCase();
        if (!['A', 'B', 'C', 'D'].includes(v)) {
          errors.push({ row, message: `Row ${row}, Q${q}: "${raw}" is not A, B, C or D` });
          bad = true;
        }
        values.push(v);
      } else {
        const n = raw === '.5' ? 0.5 : Number(raw);
        if (![0, 0.5, 1].includes(n)) {
          errors.push({ row, message: `Row ${row}, Q${q}: "${raw}" must be 0, 0.5 or 1` });
          bad = true;
        }
        values.push(n);
      }
    }
    if (!bad) rows.push({ row, reg, values });
  }
  return { rows, errors };
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildTemplateCsv(
  totalQuestions: number,
  students: { reg: string; name: string }[],
): string {
  const qs = Array.from({ length: totalQuestions }, (_, i) => `Q${i + 1}`);
  const lines = [['registration_number', 'student_name', ...qs].join(',')];
  for (const s of students) {
    lines.push([csvField(s.reg), csvField(s.name), ...qs.map(() => '')].join(','));
  }
  return lines.join('\n') + '\n';
}
