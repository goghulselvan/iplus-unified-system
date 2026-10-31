export interface GradeResult { grade: string; label: string }

export function studentGrade(pct: number): GradeResult {
  if (pct >= 95) return { grade: 'A++', label: 'Olympiad Excellence' };
  if (pct >= 90) return { grade: 'A+', label: 'National Level Potential' };
  if (pct >= 80) return { grade: 'A', label: 'High Performer' };
  if (pct >= 70) return { grade: 'B+', label: 'Strong Foundation' };
  if (pct >= 60) return { grade: 'B', label: 'Satisfactory' };
  if (pct >= 50) return { grade: 'C', label: 'Average' };
  return { grade: 'D', label: 'Needs Academic Support' };
}

export function schoolGrade(pct: number): GradeResult {
  if (pct >= 80) return { grade: 'A', label: 'Excellent' };
  if (pct >= 60) return { grade: 'B', label: 'Good' };
  if (pct >= 40) return { grade: 'C', label: 'Average' };
  return { grade: 'D', label: 'Needs Improvement' };
}
