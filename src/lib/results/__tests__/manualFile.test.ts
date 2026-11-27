import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManualSheets, parseManualTable } from '../manualFile';
import { readXlsxSheets } from '../omrFile';

describe('parseManualTable', () => {
  it('reads a per-question sheet and ignores the Total column', () => {
    const r = parseManualTable([
      ['S.No', 'Reg No', 'Student Name', 'Q1', 'Q2', 'Q3', 'Total'],
      ['1', '913380214001', 'Asha', '1', '0.5', '', '1.5'],
      ['2', '913380214002', 'Ravi', '', '', '', ''],
      ['', '', '', '', '', '', ''],
    ], 'KidsPO-LKG');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { row: 2, sheet: 'KidsPO-LKG', reg: '913380214001', kind: 'questions', values: ['1', '0.5', null] },
      { row: 3, sheet: 'KidsPO-LKG', reg: '913380214002', kind: 'questions', values: [null, null, null] },
    ]);
  });
  it('reads a totals-only sheet', () => {
    const r = parseManualTable([['Roll Number', 'Name', 'Total'], ['133380801001', 'A', '27.5']], null);
    expect(r.rows).toEqual([{ row: 2, sheet: null, reg: '133380801001', kind: 'total', total: '27.5' }]);
  });
  it('asks for question or Total columns', () => {
    expect(parseManualTable([['Roll Number', 'Name']], 'S1').errors[0].message).toMatch(/Sheet "S1" needs either question columns/);
  });
  it('ignores a sheet with no roll-number column', () => {
    expect(parseManualTable([['Instructions'], ['Fill in marks']], 'Help')).toEqual({ rows: [], errors: [], used: false });
  });
});

describe('parseManualSheets', () => {
  it('needs at least one sheet with a roll-number column', () => {
    expect(parseManualSheets([{ name: 'x', table: [['a']] }]).errors[0].message).toMatch(/Roll Number/);
  });
});

describe('readXlsxSheets + parseManualSheets on a two-sheet workbook', () => {
  it('reads a per-question sheet and a totals-only sheet in one file', async () => {
    const buf = readFileSync(join(__dirname, 'fixtures', 'sample-manual.xlsx'));
    const sheets = await readXlsxSheets(buf);
    expect(sheets.map((s) => s.name)).toEqual(['KidsPO-LKG', 'EPO-Class1-totals']);
    const { rows, errors } = parseManualSheets(sheets);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.sheet, r.row, r.reg, r.kind])).toEqual([
      ['KidsPO-LKG', 2, '913380214001', 'questions'],
      ['KidsPO-LKG', 3, '913380214002', 'questions'],
      ['EPO-Class1-totals', 2, '133380801001', 'total'],
    ]);
    expect(rows[0].values).toHaveLength(30);
    expect(rows[0].values?.[29]).toBe('0.5');
    expect(rows[2].total).toBe('27.5');
  });
});
