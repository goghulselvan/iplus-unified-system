import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOmrTable, readCsvTable, readXlsxTable } from '../omrFile';

describe('readXlsxTable + parseOmrTable on a made-up file shaped like the OMR export', () => {
  it('reads every row with roll number and 60 answers', async () => {
    const buf = readFileSync(join(__dirname, 'fixtures', 'sample-omr.xlsx'));
    const { rows, errors } = parseOmrTable(await readXlsxTable(buf));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(57);
    expect(rows[0].row).toBe(2);
    expect(rows[0].reg).toMatch(/^\d{12}$/);
    expect(rows[0].values).toHaveLength(60);
    expect(rows.filter((r) => r.reg === 'REVIEW').map((r) => r.row)).toEqual([15, 20, 26, 30, 36, 38, 46]);
    expect(rows.flatMap((r) => r.values).filter((v) => v === 'MULTIPLE')).toHaveLength(5);
    // 50-question sheets leave Q51-Q60 empty.
    expect(rows[2].values.slice(50).every((v) => v === null)).toBe(true);
  });
});

describe('parseOmrTable', () => {
  it('needs a Roll Number column', () => {
    expect(parseOmrTable([['S.No', 'Q1'], ['1', 'A']]).errors[0].message).toMatch(/Roll Number/);
  });
  it('needs question columns', () => {
    expect(parseOmrTable([['Roll Number'], ['133380804001']]).errors[0].message).toMatch(/Q1/);
  });
  it('skips empty rows, keeps blanks as null and uses spreadsheet row numbers', () => {
    const r = parseOmrTable([['Roll No', 'Q1', 'Q2'], ['', '', ''], [' 133380804001 ', 'a', '']]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ row: 3, reg: '133380804001', values: ['a', null] }]);
  });
  it('reports a file with a heading but no students', () => {
    expect(parseOmrTable([['Roll Number', 'Q1']]).errors[0].message).toMatch(/no student rows/);
  });
});

describe('readCsvTable', () => {
  it('handles quotes and CRLF', () => {
    expect(readCsvTable('﻿Roll Number,Q1\r\n"1333,8",A\r\n')).toEqual([['Roll Number', 'Q1'], ['1333,8', 'A']]);
  });
});
