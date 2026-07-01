// Data normalization helpers for consistent handling of states, districts, and boards

export const normalizeText = (text: string): string => {
  return text?.toString().trim().toUpperCase() || '';
};

// Format names to proper title case (handles initials, dots, spaces)
export const toTitleCase = (text: string): string => {
  if (!text) return '';
  
  return text
    .toString()
    .trim()
    .toLowerCase()
    .split(/(\s+|\.)/) // Split on spaces and dots but keep the separators
    .map((part, index, array) => {
      // If it's whitespace or dot, return as-is
      if (/^\s+$/.test(part) || part === '.') {
        return part;
      }
      
      // If it's an empty string (can happen with split), return as-is
      if (!part) return part;
      
      // Check if this is likely an initial (single letter followed by dot or space)
      const nextPart = array[index + 1];
      if (part.length === 1 && (nextPart === '.' || /^\s+$/.test(nextPart || ''))) {
        return part.toUpperCase();
      }
      
      // Regular word - capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
};

// Universal display formatter - ensures consistent title case display
export const formatForDisplay = (text: string | null | undefined): string => {
  if (!text) return '';
  return toTitleCase(text);
};

// Universal search formatter - ensures case-insensitive matching
export const formatForSearch = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.toString().trim().toLowerCase();
};

// Normalize district names with common spelling corrections
export const normalizeDistrictName = (district: string): string => {
  if (!district) return '';
  
  const normalized = district.toString().trim();
  
  // Handle common misspellings and variations
  switch (normalized.toUpperCase()) {
    case 'KANYAKUMARI':
    case 'KANNIYAKUMARI':
      return 'Kanniyakumari';
    case 'KANCHEEPURAM':
    case 'KANCHIPURAM':
      return 'Kancheepuram';
    case 'SIVAGANGA':
    case 'SIVAGANGAI':
      return 'Sivagangai';
    case 'NILGIRIS':
    case 'THE NILGIRIS':
      return 'The Nilgiris';
    default:
      return toTitleCase(normalized);
  }
};

export const normalizeStateDistrict = (text: string): string => {
  // First apply basic normalization
  let normalized = normalizeText(text)
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/BANGALORE/gi, 'BENGALURU') // Standardize Bangalore to Bengaluru
    .replace(/BOMBAY/gi, 'MUMBAI') // Standardize Bombay to Mumbai
    .replace(/CALCUTTA/gi, 'KOLKATA'); // Standardize Calcutta to Kolkata
  
  // Apply district-specific corrections
  switch (normalized.toUpperCase()) {
    case 'KANYAKUMARI':
    case 'KANNIYAKUMARI':
      return 'KANNIYAKUMARI';
    case 'KANCHEEPURAM':
    case 'KANCHIPURAM':
      return 'KANCHEEPURAM';
    case 'SIVAGANGA':
    case 'SIVAGANGAI':
      return 'SIVAGANGAI';
    case 'NILGIRIS':
    case 'THE NILGIRIS':
      return 'THE NILGIRIS';
    default:
      return normalized;
  }
};

export const normalizeBoard = (board: string, state?: string): string => {
  const normalized = normalizeText(board);
  
  // Standardize common board variations
  const boardMappings: { [key: string]: string } = {
    'CBSE': 'CBSE',
    'C.B.S.E': 'CBSE',
    'C.B.S.E.': 'CBSE',
    'CENTRAL BOARD OF SECONDARY EDUCATION': 'CBSE',
    'ICSE': 'ICSE',
    'I.C.S.E': 'ICSE',
    'I.C.S.E.': 'ICSE',
    'INDIAN CERTIFICATE OF SECONDARY EDUCATION': 'ICSE',
    'ISC': 'ISC',
    'I.S.C': 'ISC',
    'I.S.C.': 'ISC',
    'INDIAN SCHOOL CERTIFICATE': 'ISC',
    'STATE BOARD': 'MATRICULATION',
    'STATE': 'MATRICULATION',
    'MATRICULATION': 'MATRICULATION',
    'MATRIC': 'MATRICULATION',
    'TN-N&P': 'TN-N&P',
    'TN N&P': 'TN-N&P',
    'TAMIL NADU N&P': 'TN-N&P'
  };

  let mappedBoard = boardMappings[normalized] || normalized;
  
  // All State Board entries should now be Matriculation
  return mappedBoard;
};

// Case-insensitive board matching against active boards
export const findMatchingActiveBoard = (inputBoard: string, activeBoardNames: string[], state?: string): string | null => {
  // First normalize the input board with state context for Tamil Nadu
  const normalizedInput = normalizeBoard(inputBoard, state);
  const inputNormalized = normalizeText(normalizedInput);
  
  // Try exact match with normalized board name
  const exactMatch = activeBoardNames.find(board => normalizeText(board) === inputNormalized);
  if (exactMatch) return exactMatch;
  
  // Try matching with original input (case insensitive)
  const originalInputNormalized = normalizeText(inputBoard);
  const originalMatch = activeBoardNames.find(board => normalizeText(board) === originalInputNormalized);
  if (originalMatch) return originalMatch;
  
  // Try partial match (case insensitive)
  const partialMatch = activeBoardNames.find(board => {
    const boardNormalized = normalizeText(board);
    return boardNormalized.includes(inputNormalized) || 
           inputNormalized.includes(boardNormalized) ||
           boardNormalized.includes(originalInputNormalized) ||
           originalInputNormalized.includes(boardNormalized);
  });
  
  return partialMatch || null;
};

// Validation helpers
export const validateSchoolData = (schoolData: any, isPartialUpdate: boolean = false): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // For partial updates (like manual edits), only validate fields that are actually being updated and non-empty
  if (isPartialUpdate) {
    // Only validate fields that are provided and check if they're meaningful
    if ('school_name' in schoolData && schoolData.school_name !== undefined && !schoolData.school_name?.trim()) {
      errors.push('School name cannot be empty');
    }

    if ('state' in schoolData && schoolData.state !== undefined && !schoolData.state?.trim()) {
      errors.push('State cannot be empty');
    }

    if ('district' in schoolData && schoolData.district !== undefined && !schoolData.district?.trim()) {
      errors.push('District cannot be empty');
    }

    if ('board' in schoolData && schoolData.board !== undefined && !schoolData.board?.trim()) {
      errors.push('Board cannot be empty');
    }
  } else {
    // For complete validation (new records), require all essential fields
    if (!schoolData.school_name?.trim()) {
      errors.push('School name is required');
    }

    if (!schoolData.state?.trim()) {
      errors.push('State is required');
    }

    if (!schoolData.district?.trim()) {
      errors.push('District is required');
    }

    if (!schoolData.board?.trim()) {
      errors.push('Board is required');
    }
  }

  // Common validations for both cases
  if (schoolData.ss_no && isNaN(Number(schoolData.ss_no))) {
    errors.push('SS Number must be a valid number');
  }

  // Email validation if provided
  if (schoolData.email && schoolData.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(schoolData.email.trim())) {
      errors.push('Invalid email format');
    }
  }

  // Phone validation if provided
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  if (schoolData.mobile1 && schoolData.mobile1.trim() && !phoneRegex.test(schoolData.mobile1.trim())) {
    errors.push('Invalid mobile number format');
  }

  if (schoolData.mobile2 && schoolData.mobile2.trim() && !phoneRegex.test(schoolData.mobile2.trim())) {
    errors.push('Invalid secondary mobile number format');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Pre-process school data before saving
export const normalizeSchoolData = (schoolData: any) => {
  const normalizedState = normalizeStateDistrict(schoolData.state || '');
  
  return {
    ...schoolData,
    state: normalizedState,
    district: normalizeStateDistrict(schoolData.district || ''),
    board: normalizeBoard(schoolData.board || '', normalizedState),
    school_name: schoolData.school_name?.toString().trim() || '',
    school_address: schoolData.school_address?.toString().trim() || '',
    contact_person_name: schoolData.contact_person_name?.toString().trim() || '',
    email: schoolData.email?.toString().trim().toLowerCase() || null,
    mobile1: schoolData.mobile1?.toString().trim() || null,
    mobile2: schoolData.mobile2?.toString().trim() || null,
    pincode: schoolData.pincode?.toString().trim() || ''
  };
};