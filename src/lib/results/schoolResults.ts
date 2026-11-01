/** Plain-English comparison with the state average, e.g. "6% above state average". */
export function vsStateText(diff: number): string {
  const n = Math.round(Math.abs(diff));
  if (!Number.isFinite(diff) || n === 0) return "Same as state average";
  return `${n}% ${diff > 0 ? "above" : "below"} state average`;
}

/** Difference between a school's average and the state's, or null when either is unknown. */
export function vsStateDiff(avg: number | null | undefined, stateAvg: number | null | undefined): number | null {
  if (avg == null || stateAvg == null) return null;
  return Number(avg) - Number(stateAvg);
}
