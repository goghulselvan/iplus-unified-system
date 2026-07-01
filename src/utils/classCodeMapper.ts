/**
 * Maps class names to their numeric codes for database storage
 * This mapping is used for registration number generation and validation
 */
export const getClassCode = (className: string): number => {
  const classMap: Record<string, number> = {
    'LKG': 14,
    'UKG': 15,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    '11': 11,
    '12': 12,
  };

  const normalized = className.toUpperCase().trim();
  const code = classMap[normalized];
  
  if (code === undefined) {
    throw new Error(`Invalid class name: ${className}`);
  }
  
  return code;
};

/**
 * Checks if a class is LKG or UKG (KidsPO eligible)
 */
export const isKidsPoEligible = (className: string): boolean => {
  const normalized = className.toUpperCase().trim();
  return normalized === 'LKG' || normalized === 'UKG';
};
