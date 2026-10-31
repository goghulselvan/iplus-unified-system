import { describe, it, expect } from 'vitest';
import { parseEvaluationCsv, buildTemplateCsv } from '../evaluationCsv';

describe('parseEvaluationCsv', () => {
  it('OMR trims, upper-cases, blank -> null', () => {
    const r = parseEvaluationCsv('registration_number,Q1,Q2,Q3,Q4\n2-33-03-06-03-001, a ,b,,D\n', 'omr', 4);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ row: 2, reg: '233030603001', values: ['A', 'B', null, 'D'] }]);
  });
  it('handles BOM, CRLF, quoted fields, Q01 headers, extra columns', () => {
    const t = '﻿Reg No,"Student Name",Q01,Q02\r\n"233030603002","Doe, Jo",c,D\r\n';
    const r = parseEvaluationCsv(t, 'omr', 2);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({ row: 2, reg: '233030603002', values: ['C', 'D'] });
  });
  it('numeric headers and "roll no"', () => {
    const r = parseEvaluationCsv('Roll No,1,2\n233030601001,.5,1\n', 'manual', 2);
    expect(r.rows[0].values).toEqual([0.5, 1]);
  });
  it('manual blank -> null, bad value error', () => {
    const r = parseEvaluationCsv('registration_number,Q1,Q2\n233030601001,,2\n', 'manual', 2);
    expect(r.rows).toEqual([]);
    expect(parseEvaluationCsv('registration_number,Q1,Q2\n233030601001,,1\n', 'manual', 2).rows[0].values).toEqual([null, 1]);
    expect(r.errors).toEqual([{ row: 2, message: 'Row 2, Q2: "2" must be 0, 0.5 or 1' }]);
  });
  it('OMR bad letter', () => {
    const r = parseEvaluationCsv('registration_number,Q1\n233030603001,E\n', 'omr', 1);
    expect(r.errors[0].message).toBe('Row 2, Q1: "E" is not A, B, C or D');
  });
  it('missing columns', () => {
    const cols = Array.from({ length: 48 }, (_, i) => `Q${i + 1}`).join(',');
    const r = parseEvaluationCsv(`registration_number,${cols}\n`, 'omr', 50);
    expect(r.errors).toEqual([{ row: 1, message: 'The file is missing question columns Q49, Q50; this paper has 50 questions' }]);
    expect(r.rows).toEqual([]);
  });
  it('missing reg column / missing reg number', () => {
    expect(parseEvaluationCsv('name,Q1\nx,A\n', 'omr', 1).errors[0].row).toBe(1);
    const r = parseEvaluationCsv('registration_number,Q1\n,A\n', 'omr', 1);
    expect(r.errors).toEqual([{ row: 2, message: 'Row 2 has no registration number' }]);
  });
  it('skips fully blank lines', () => {
    const r = parseEvaluationCsv('registration_number,Q1\n233030603001,A\n\n233030603002,B\n', 'omr', 1);
    expect(r.rows.map(x => x.row)).toEqual([2, 4]);
  });
  it('template round-trips', () => {
    const csv = buildTemplateCsv(3, [{ reg: '2-33-03-06-03-001', name: 'A, B' }]);
    expect(csv.split('\n')[0]).toBe('registration_number,student_name,Q1,Q2,Q3');
    const r = parseEvaluationCsv(csv, 'omr', 3);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ row: 2, reg: '233030603001', values: [null, null, null] }]);
  });

  it('unterminated quote is an error and the record is omitted', () => {
    const r = parseEvaluationCsv('registration_number,Q1\n233030601001,A\n"233030601002,B', 'omr', 1);
    expect(r.rows.map(x => x.row)).toEqual([2]);
    expect(r.errors).toEqual([{ row: 3, message: 'Row 3: a quoted value is not closed' }]);
  });
  it('missing columns counts only Q1..Qn and lists gaps (max 10)', () => {
    const r = parseEvaluationCsv('registration_number,Q1,Q3,Q4\n', 'omr', 3);
    expect(r.errors[0].message).toBe('The file is missing question columns Q2; this paper has 3 questions');
    const h = 'registration_number,Q1\n';
    expect(parseEvaluationCsv(h, 'omr', 14).errors[0].message)
      .toBe('The file is missing question columns Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11 and 3 more; this paper has 14 questions');
  });
  it('Excel-mangled registration number', () => {
    const r = parseEvaluationCsv('registration_number,Q1\n2.33031E+11,A\n', 'omr', 1);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ row: 2, message: 'Row 2: the registration number "2.33031E+11" was changed by Excel. Format that column as Text and save the file again.' }]);
  });
  it('manual rejects -0 and exponent forms', () => {
    for (const v of ['-0', '1e0', '0x1', '0.5.0']) {
      const r = parseEvaluationCsv(`registration_number,Q1\n233030601001,${v}\n`, 'manual', 1);
      expect(r.errors[0].message).toBe(`Row 2, Q1: "${v}" must be 0, 0.5 or 1`);
    }
    expect(parseEvaluationCsv('registration_number,Q1\n233030601001,1.0\n', 'manual', 1).rows[0].values).toEqual([1]);
  });
  it('template has BOM and hyphenated regs', () => {
    const csv = buildTemplateCsv(1, [{ reg: '233030603001', name: 'X' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\n')[1]).toBe('2-33-03-06-03-001,X,');
  });
});
