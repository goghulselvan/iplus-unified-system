export type OlympiadCode = 'EPO' | 'MPO' | 'SPO' | 'GKSSPO' | 'LRPO' | 'KidsPO';

const OLYMPIAD_BY_DIGIT: Record<string, OlympiadCode> = {
  '1': 'EPO', '2': 'MPO', '3': 'SPO', '4': 'GKSSPO', '5': 'LRPO', '9': 'KidsPO',
};

export interface ParsedReg {
  olympiad: OlympiadCode;
  state: string;
  district: string;
  school: string;
  classCode: string;
  roll: string;
}

export function regDigits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

export function parseReg(s: string): ParsedReg | null {
  const d = regDigits(s);
  if (d.length !== 12) return null;
  const olympiad = OLYMPIAD_BY_DIGIT[d[0]];
  if (!olympiad) return null;
  return {
    olympiad,
    state: d.slice(1, 3),
    district: d.slice(3, 5),
    school: d.slice(5, 7),
    classCode: d.slice(7, 9),
    roll: d.slice(9, 12),
  };
}

export function formatReg(digits: string): string {
  const d = regDigits(digits);
  if (d.length !== 12) return digits;
  return [d.slice(0, 1), d.slice(1, 3), d.slice(3, 5), d.slice(5, 7), d.slice(7, 9), d.slice(9, 12)].join('-');
}

export function answerMode(classCode: string): 'manual' | 'omr' {
  return ['14', '15', '01', '02'].includes(classCode) ? 'manual' : 'omr';
}
