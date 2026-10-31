import { regDigits, formatReg } from './regNumber';

export interface CsvRow { row: number; reg: string; values: (string | number | null)[] }
export interface CsvError { row: number; message: string }

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF/LF/CR, embedded newlines. */
function parseCsv(text: string): { records: string[][]; unterminated: boolean } {
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
  return { records, unterminated: inQ };
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
  const { records, unterminated } = parseCsv(text);
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
    const shown = missing.slice(0, 10).map(q => `Q${q}`).join(', ');
    const more = missing.length > 10 ? ` and ${missing.length - 10} more` : '';
    return {
      rows,
      errors: [{
        row: 1,
        message: `The file is missing question columns ${shown}${more}; this paper has ${totalQuestions} questions`,
      }],
    };
  }

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.every(c => c.trim() === '')) continue;
    const row = r + 1;
    if (unterminated && r === records.length - 1) {
      errors.push({ row, message: `Row ${row}: a quoted value is not closed` });
      continue;
    }
    const rawReg = (rec[regCol] ?? '').trim();
    if (/e\+/i.test(rawReg)) {
      errors.push({
        row,
        message: `Row ${row}: the registration number "${rawReg}" was changed by Excel. Format that column as Text and save the file again.`,
      });
      continue;
    }
    const reg = regDigits(rawReg);
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
        const n = Number(raw);
        if (!/^(?:[01](?:\.0+)?|0?\.50*)$/.test(raw)) {
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
  const lines = ['\uFEFF' + ['registration_number', 'student_name', ...qs].join(',')];
  for (const s of students) {
    lines.push([csvField(formatReg(s.reg)), csvField(s.name), ...qs.map(() => '')].join(','));
  }
  return lines.join('\n') + '\n';
}
