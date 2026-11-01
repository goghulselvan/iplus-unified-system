import { csvCell } from "./rankingsCsv";
import { formatReg, regDigits } from "./regNumber";

/** Columns the certificate printer asks for, in this order. */
export const PRINTER_CSV_HEADER = ["Reg no", "Name", "Class", "Olympiad", "School", "Award"];

export interface PrinterRow {
  regNumber: string;
  name: string;
  className: string;
  olympiad: string;
  school: string;
  award: string;
}

/** CSV text (CRLF, quoted where needed, formula-looking text neutralised). The download adds the UTF-8 BOM. */
export function printerCsv(rows: PrinterRow[]): string {
  const line = (cells: (string | null | undefined)[]) => cells.map(csvCell).join(",");
  return [
    line(PRINTER_CSV_HEADER),
    ...rows.map((r) => line([formatReg(r.regNumber), r.name, r.className, r.olympiad, r.school, r.award])),
  ].join("\r\n") + "\r\n";
}

// ---------- courier pack data (the shape slot_dispatch_pdfs/packs.mjs reads from schools.json) ----------

export interface CourierAwardee {
  schoolId: string;
  schoolName: string;
  district: string | null;
  ssNo: number | null;
  regNumber: string;
  name: string;
  classCode: string;
  olympiad: string;
}

export interface CourierSchool {
  id: string;
  name: string;
  district: string;
  ss_no: number | null;
  school_code: string | null;
  /** Students receiving an award. */
  students: number;
  /** Awards (one line per student and olympiad). */
  qp: number;
  omr: number;
  unpaid: number;
  cells: { c: string; n: number; s: string }[];
  roster: { c: string; n: string; r: string; s: string }[];
}

/** State + district + school digits of the registration number, e.g. 1-33-21-03-07-001 gives "332103". */
export const schoolCodeFromReg = (reg: string): string | null => {
  const d = regDigits(reg);
  return d.length === 12 ? d.slice(1, 7) : null;
};

export function courierPackData(awardees: CourierAwardee[]): CourierSchool[] {
  const bySchool = new Map<string, CourierAwardee[]>();
  for (const a of awardees) bySchool.set(a.schoolId, [...(bySchool.get(a.schoolId) ?? []), a]);
  return [...bySchool.values()]
    .map((list) => {
      const first = list[0];
      const cellMap = new Map<string, { c: string; n: number; s: string }>();
      for (const a of list) {
        const k = `${a.classCode}|${a.olympiad}`;
        const cell = cellMap.get(k) ?? { c: a.classCode, n: 0, s: a.olympiad };
        cell.n++;
        cellMap.set(k, cell);
      }
      return {
        id: first.schoolId,
        name: first.schoolName,
        district: first.district ?? "",
        ss_no: first.ssNo,
        school_code: list.map((a) => schoolCodeFromReg(a.regNumber)).find(Boolean) ?? null,
        students: new Set(list.map((a) => a.regNumber || a.name)).size,
        qp: list.length,
        omr: 0,
        unpaid: 0,
        cells: [...cellMap.values()].sort((x, y) => x.c.localeCompare(y.c) || x.s.localeCompare(y.s)),
        roster: list.map((a) => ({ c: a.classCode, n: a.name, r: formatReg(a.regNumber), s: a.olympiad })),
      } as CourierSchool;
    })
    .sort((a, b) => (a.ss_no ?? 1e9) - (b.ss_no ?? 1e9) || a.name.localeCompare(b.name));
}
