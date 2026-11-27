import { isRollHeader, readCsvTable, readXlsxSheets } from './omrFile';

/**
 * Reads hand-marked results for LKG to Class 2 (.xlsx with any number of sheets, or .csv).
 * Each sheet is either per question (Roll + Q1..Qn, marks 0 / 0.5 / 1, any Total column is
 * ignored: the system adds the marks) or totals only (Roll + Total). Row numbers are the
 * spreadsheet's own; the server checks every value and finds each student's paper.
 */
export interface ManualRow {
  row: number;
  sheet: string | null;
  reg: string;
  kind: 'questions' | 'total';
  values?: (string | null)[];
  total?: string | null;
}
export interface ManualFileError { row: number; sheet: string | null; message: string }

const isTotalHeader = (h: string | undefined) => /^\s*(total|total marks|marks|score)\s*$/i.test(h ?? '');

export function parseManualTable(table: string[][], sheet: string | null): { rows: ManualRow[]; errors: ManualFileError[]; used: boolean } {
  const headerAt = table.findIndex((r) => r.some((c) => isRollHeader(c)));
  if (headerAt < 0) return { rows: [], errors: [], used: false };
  const header = table[headerAt];
  const regCol = header.findIndex((c) => isRollHeader(c));
  const qCol = new Map<number, number>();
  header.forEach((h, i) => {
    const m = /^q\s*0*(\d+)$/i.exec((h ?? '').trim());
    if (m && !qCol.has(+m[1])) qCol.set(+m[1], i);
  });
  let last = 0;
  while (qCol.has(last + 1)) last++;
  const totalCol = header.findIndex((c) => isTotalHeader(c));
  const where = sheet ? `Sheet "${sheet}"` : 'The file';
  if (last === 0 && totalCol < 0) {
    return { rows: [], used: true, errors: [{ row: headerAt + 1, sheet, message: `${where} needs either question columns (Q1, Q2, …) or a "Total" column` }] };
  }
  const kind: ManualRow['kind'] = last > 0 ? 'questions' : 'total';
  const rows: ManualRow[] = [];
  for (let r = headerAt + 1; r < table.length; r++) {
    const rec = table[r] ?? [];
    const reg = (rec[regCol] ?? '').trim();
    const cell = (i: number) => { const v = (rec[i] ?? '').trim(); return v === '' ? null : v; };
    if (kind === 'questions') {
      const values = Array.from({ length: last }, (_, q) => cell(qCol.get(q + 1)!));
      if (!reg && values.every((v) => v === null)) continue;
      rows.push({ row: r + 1, sheet, reg, kind, values });
    } else {
      const total = cell(totalCol);
      if (!reg && total === null) continue;
      rows.push({ row: r + 1, sheet, reg, kind, total });
    }
  }
  return { rows, errors: [], used: true };
}

export function parseManualSheets(sheets: { name: string | null; table: string[][] }[]): { rows: ManualRow[]; errors: ManualFileError[] } {
  const rows: ManualRow[] = [];
  const errors: ManualFileError[] = [];
  let used = 0;
  for (const s of sheets) {
    const r = parseManualTable(s.table, s.name);
    if (r.used) used++;
    rows.push(...r.rows);
    errors.push(...r.errors);
  }
  if (used === 0) errors.push({ row: 1, sheet: null, message: 'The file needs a "Roll Number" (or "Reg No") column in the heading row' });
  else if (!errors.length && rows.length === 0) errors.push({ row: 0, sheet: null, message: 'The file has no student rows' });
  return { rows, errors };
}

export async function readManualFile(file: File): Promise<{ rows: ManualRow[]; errors: ManualFileError[] }> {
  if (/\.xlsx$/i.test(file.name)) return parseManualSheets(await readXlsxSheets(await file.arrayBuffer()));
  if (/\.csv$/i.test(file.name)) return parseManualSheets([{ name: null, table: readCsvTable(await file.text()) }]);
  return { rows: [], errors: [{ row: 0, sheet: null, message: 'Please choose the marks file as .xlsx or .csv.' }] };
}
