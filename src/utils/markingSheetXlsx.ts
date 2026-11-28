import { Cell, SheetSpec, colName, downloadXLSXWorkbook } from './xlsxExport';

/**
 * Manual marking sheet for LKG–Class 2 (the classes marked by hand, 0 / 0.5 / 1
 * per question). One sheet per olympiad × class. Column headers match what the
 * Results module's answer upload reads: "Reg No" + Q1..Qn; other columns are ignored.
 */
export interface MarkingRow {
  name: string;
  classCode: string;
  subject: string;
  registrationNumber: string | null;
}

// Question counts per class — same as the `classes` table.
const QUESTIONS: Record<string, number> = { '14': 30, '15': 30, '01': 40, '02': 40 };
const CLASS_TAG: Record<string, string> = { '14': 'LKG', '15': 'UKG', '01': 'Class1', '02': 'Class2' };
const CLASS_ORDER = ['14', '15', '01', '02'];
const SUBJECT_ORDER = ['KidsPO', 'EPO', 'MPO', 'SPO', 'GKSSPO', 'LRPO'];

export const isManualMarkingClass = (classCode: string) => classCode in QUESTIONS;

export function buildMarkingSheets(rows: MarkingRow[]): SheetSpec[] {
  const groups = new Map<string, MarkingRow[]>();
  for (const r of rows) {
    if (!isManualMarkingClass(r.classCode)) continue;
    const key = `${r.classCode}|${r.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const rank = (list: string[], v: string) => (list.indexOf(v) + 1) || list.length + 1;
  const keys = [...groups.keys()].sort((a, b) => {
    const [ca, sa] = a.split('|');
    const [cb, sb] = b.split('|');
    return rank(CLASS_ORDER, ca) - rank(CLASS_ORDER, cb) || rank(SUBJECT_ORDER, sa) - rank(SUBJECT_ORDER, sb) || sa.localeCompare(sb);
  });

  return keys.map((key) => {
    const [classCode, subject] = key.split('|');
    const n = QUESTIONS[classCode];
    const firstQ = colName(3);           // D
    const lastQ = colName(3 + n - 1);
    const students = groups.get(key)!.slice().sort((a, b) =>
      (a.registrationNumber ?? '').localeCompare(b.registrationNumber ?? '') || a.name.localeCompare(b.name));

    const header: Cell[] = ['S.No', 'Reg No', 'Student Name', ...Array.from({ length: n }, (_, i) => `Q${i + 1}`), 'Total'];
    const body: Cell[][] = students.map((s, i) => {
      const r = i + 2;
      return [
        i + 1,
        s.registrationNumber ? s.registrationNumber.replace(/\D/g, '') : '',
        s.name,
        ...Array<Cell>(n).fill(null),
        { formula: `IF(COUNT(${firstQ}${r}:${lastQ}${r})=0,"",SUM(${firstQ}${r}:${lastQ}${r}))` },
      ];
    });

    return {
      name: `${subject}-${CLASS_TAG[classCode]}`,
      rows: [header, ...body],
      colWidths: [6, 15, 30, ...Array(n).fill(5), 7],
      listValidation: students.length
        ? { sqref: `${firstQ}2:${lastQ}${students.length + 1}`, values: ['0', '0.5', '1'], error: 'Enter 0, 0.5 or 1' }
        : undefined,
    };
  });
}

export const downloadMarkingSheet = (rows: MarkingRow[], filename: string) =>
  downloadXLSXWorkbook(buildMarkingSheets(rows), filename);
