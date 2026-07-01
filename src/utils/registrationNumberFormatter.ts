// Optimized registration number formatting with memoization
const formatCache = new Map<string, string>();

export const formatRegistrationNumberDisplay = (
  registrationNumber: string,
  componentOrder?: string[],
  separator: string = "-"
): string => {
  if (!registrationNumber || !componentOrder) {
    return registrationNumber;
  }

  const cacheKey = `${registrationNumber}:${componentOrder.join(',')}:${separator}`;
  if (formatCache.has(cacheKey)) return formatCache.get(cacheKey)!;

  const components = registrationNumber.split("-");
  if (components.length < 6) {
    formatCache.set(cacheKey, registrationNumber);
    return registrationNumber;
  }

  const componentMap: Record<string, string> = {
    subject: components[0],
    state: components[1],
    district: components[2],
    school: components[3],
    class: components[4],
    student: components[5],
  };

  const reorderedComponents = componentOrder
    .filter(key => key !== 'subject')
    .map(key => componentMap[key]);
  const result = reorderedComponents.join(separator);

  if (formatCache.size > 1000) {
    const firstKey = formatCache.keys().next().value;
    formatCache.delete(firstKey);
  }
  formatCache.set(cacheKey, result);
  return result;
};

export const clearFormatCache = () => {
  formatCache.clear();
};

/**
 * Strip the leading subject-code segment from a stored registration number.
 * Stored: SUBJECT-STATE-DISTRICT-SCHOOL-CLASS-STUDENT
 * Display:        STATE-DISTRICT-SCHOOL-CLASS-STUDENT
 */
export const stripSubjectPrefix = (regNo?: string | null): string => {
  if (!regNo) return "";
  const idx = regNo.indexOf("-");
  if (idx < 0) return regNo;
  const prefix = regNo.slice(0, idx);
  if (!/^[A-Za-z0-9]+$/.test(prefix)) return regNo;
  return regNo.slice(idx + 1);
};

/**
 * Format a 6-segment stored registration number into the 4-segment student-facing display.
 *
 * Stored (6 segments): {subject}-{state}-{district}-{school}-{class}-{roll}
 * Example stored:      2-33-38-01-05-001
 *
 * Displayed (4 segments): {subject}-{SCHOOLCODE}-{class}-{roll}
 * Example displayed:      2-333801-05-001
 *
 * SCHOOL CODE = state + district + school concatenated (6 digits, no separator).
 *
 * Works for both old 14-digit format (3-digit district/school) and new 12-digit format
 * (2-digit district/school) — the concatenation is the same either way.
 */
export const formatRegNumberForStudent = (regNo?: string | null): string => {
  if (!regNo) return "";
  const parts = regNo.split("-");
  if (parts.length !== 6) return regNo; // not a recognised format, return as-is
  const [subject, state, district, school, cls, roll] = parts;
  const schoolCode = state + district + school;
  return `${subject}-${schoolCode}-${cls}-${roll}`;
};

/**
 * Parse a 6-segment stored registration number into its components.
 * Returns null if the format is not recognised.
 */
export const parseStoredRegNumber = (regNo?: string | null): {
  subject: string;
  state: string;
  district: string;
  school: string;
  schoolCode: string;
  classCode: string;
  roll: string;
} | null => {
  if (!regNo) return null;
  const parts = regNo.split("-");
  if (parts.length !== 6) return null;
  const [subject, state, district, school, classCode, roll] = parts;
  return {
    subject,
    state,
    district,
    school,
    schoolCode: state + district + school,
    classCode,
    roll,
  };
};
