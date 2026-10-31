import { describe, it, expect } from 'vitest';
import { studentGrade, schoolGrade } from '../grading';

describe('studentGrade', () => {
  it.each([
    [100, 'A++', 'Olympiad Excellence'], [95, 'A++', 'Olympiad Excellence'],
    [94, 'A+', 'National Level Potential'], [90, 'A+', 'National Level Potential'],
    [89, 'A', 'High Performer'], [80, 'A', 'High Performer'],
    [79, 'B+', 'Strong Foundation'], [70, 'B+', 'Strong Foundation'],
    [69, 'B', 'Satisfactory'], [60, 'B', 'Satisfactory'],
    [59, 'C', 'Average'], [50, 'C', 'Average'],
    [49, 'D', 'Needs Academic Support'], [0, 'D', 'Needs Academic Support'],
  ])('%i -> %s', (pct, grade, label) => {
    expect(studentGrade(pct)).toEqual({ grade, label });
  });
});

describe('schoolGrade', () => {
  it.each([
    [80, 'A', 'Excellent'], [79, 'B', 'Good'], [60, 'B', 'Good'],
    [59, 'C', 'Average'], [40, 'C', 'Average'], [39, 'D', 'Needs Improvement'],
  ])('%i -> %s', (pct, grade, label) => {
    expect(schoolGrade(pct)).toEqual({ grade, label });
  });
});
