import { describe, it, expect } from 'vitest';
import { regDigits, parseReg, formatReg, answerMode } from '../regNumber';

describe('regNumber', () => {
  it('parses a hyphenated number', () => {
    expect(parseReg('2-33-03-06-01-020')).toEqual({
      olympiad: 'MPO', state: '33', district: '03', school: '06', classCode: '01', roll: '020',
    });
  });
  it('rejects bad input', () => {
    expect(parseReg('12345')).toBeNull();
    expect(parseReg('7-33-03-06-01-020')).toBeNull();
    expect(parseReg('')).toBeNull();
  });
  it('maps olympiad digits', () => {
    expect(parseReg('933030601020')?.olympiad).toBe('KidsPO');
    expect(parseReg('133030601020')?.olympiad).toBe('EPO');
    expect(parseReg('433030601020')?.olympiad).toBe('GKSSPO');
    expect(parseReg('533030601020')?.olympiad).toBe('LRPO');
    expect(parseReg('333030601020')?.olympiad).toBe('SPO');
  });
  it('regDigits strips non-digits', () => {
    expect(regDigits(' 2-33 03.06-01-020 ')).toBe('233030601020');
  });
  it('formatReg', () => {
    expect(formatReg('233030601020')).toBe('2-33-03-06-01-020');
    expect(formatReg('2-33-03-06-01-020')).toBe('2-33-03-06-01-020');
  });
  it('answerMode', () => {
    for (const c of ['14', '15', '01', '02']) expect(answerMode(c)).toBe('manual');
    for (const c of ['03', '04', '05', '06', '07', '08']) expect(answerMode(c)).toBe('omr');
  });
});
