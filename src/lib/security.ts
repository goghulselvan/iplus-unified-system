import { z } from 'zod';

// Input validation schemas
export const emailSchema = z.string().email('Invalid email format');

export const phoneSchema = z.string()
  .regex(/^[+]?[0-9\s\-()]+$/, 'Invalid phone number format')
  .min(10, 'Phone number too short')
  .max(15, 'Phone number too long');

export const schoolNameSchema = z.string()
  .min(2, 'School name must be at least 2 characters')
  .max(100, 'School name too long')
  .regex(/^[a-zA-Z0-9\s\-.,()&]+$/, 'Invalid characters in school name');

export const addressSchema = z.string()
  .min(5, 'Address must be at least 5 characters')
  .max(200, 'Address too long');

export const districtSchema = z.string()
  .min(2, 'District name must be at least 2 characters')
  .max(50, 'District name too long')
  .regex(/^[a-zA-Z\s\-]+$/, 'Invalid characters in district name');

export const boardSchema = z.string()
  .min(2, 'Board name must be at least 2 characters')
  .max(50, 'Board name too long');

export const studentNameSchema = z.string()
  .min(2, 'Student name must be at least 2 characters')
  .max(50, 'Student name too long')
  .regex(/^[a-zA-Z\s\-.]+$/, 'Invalid characters in student name');

export const rollNumberSchema = z.string()
  .min(1, 'Roll number required')
  .max(20, 'Roll number too long')
  .regex(/^[a-zA-Z0-9\-]+$/, 'Invalid characters in roll number');

// Sanitization functions
export const sanitizeString = (input: string): string => {
  return input.trim().replace(/[<>\"'&]/g, '');
};

export const sanitizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

export const sanitizePhone = (phone: string): string => {
  return phone.replace(/[^\d+\s\-()]/g, '');
};

// Rate limiting helper
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export const checkRateLimit = (key: string, maxRequests: number = 5, windowMs: number = 60000): boolean => {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
};

// Advanced rate limiting with burst protection
const advancedRateLimitMap = new Map<string, { 
  requests: Array<{ timestamp: number; weight: number }>;
  blockedUntil?: number;
}>();

export const checkAdvancedRateLimit = (
  key: string, 
  maxRequests: number = 10, 
  windowMs: number = 60000,
  burstLimit: number = 20,
  blockDurationMs: number = 300000 // 5 minutes
): boolean => {
  const now = Date.now();
  const record = advancedRateLimitMap.get(key) || { requests: [] };
  
  // Check if currently blocked
  if (record.blockedUntil && now < record.blockedUntil) {
    return false;
  }
  
  // Clear expired block
  if (record.blockedUntil && now >= record.blockedUntil) {
    delete record.blockedUntil;
  }
  
  // Clean old requests
  record.requests = record.requests.filter(req => now - req.timestamp < windowMs);
  
  // Check burst limit
  if (record.requests.length >= burstLimit) {
    record.blockedUntil = now + blockDurationMs;
    advancedRateLimitMap.set(key, record);
    return false;
  }
  
  // Check regular limit
  if (record.requests.length >= maxRequests) {
    return false;
  }
  
  // Add current request
  record.requests.push({ timestamp: now, weight: 1 });
  advancedRateLimitMap.set(key, record);
  
  return true;
};

// PII Detection and Masking
export const detectPII = (text: string): Array<{ type: string; value: string; start: number; end: number }> => {
  const patterns = [
    { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { type: 'phone', regex: /(\+91|91)?[\s\-]?[6-9]\d{9}/g },
    { type: 'pancard', regex: /[A-Z]{5}[0-9]{4}[A-Z]{1}/g },
    { type: 'aadhaar', regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
  ];
  
  const detectedPII: Array<{ type: string; value: string; start: number; end: number }> = [];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      detectedPII.push({
        type: pattern.type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  });
  
  return detectedPII;
};

export const maskPII = (text: string, maskChar: string = '*'): string => {
  const piiItems = detectPII(text);
  let maskedText = text;
  
  // Sort by position (reverse order to maintain indices)
  piiItems.sort((a, b) => b.start - a.start);
  
  piiItems.forEach(item => {
    let masked: string;
    if (item.type === 'email') {
      const [local, domain] = item.value.split('@');
      masked = local.charAt(0) + maskChar.repeat(local.length - 2) + local.charAt(local.length - 1) + '@' + domain;
    } else if (item.type === 'phone') {
      masked = item.value.substring(0, 2) + maskChar.repeat(item.value.length - 4) + item.value.substring(item.value.length - 2);
    } else {
      masked = item.value.substring(0, 2) + maskChar.repeat(item.value.length - 4) + item.value.substring(item.value.length - 2);
    }
    
    maskedText = maskedText.substring(0, item.start) + masked + maskedText.substring(item.end);
  });
  
  return maskedText;
};

// Input validation with sanitization
export const validateAndSanitizeInput = (input: string, type: 'email' | 'phone' | 'name' | 'text'): { isValid: boolean; sanitized: string; errors: string[] } => {
  const errors: string[] = [];
  let sanitized = sanitizeString(input);
  let isValid = true;
  
  try {
    switch (type) {
      case 'email':
        emailSchema.parse(sanitized);
        sanitized = sanitizeEmail(sanitized);
        break;
      case 'phone':
        phoneSchema.parse(sanitized);
        sanitized = sanitizePhone(sanitized);
        break;
      case 'name':
        studentNameSchema.parse(sanitized);
        break;
      case 'text':
        if (sanitized.length === 0) {
          errors.push('Input cannot be empty');
          isValid = false;
        }
        break;
    }
  } catch (error: any) {
    isValid = false;
    errors.push(error.message);
  }
  
  return { isValid, sanitized, errors };
};

// Security headers for API requests
export const getSecurityHeaders = (csrfToken?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };

  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  return headers;
};

// Business hours validation
export const isBusinessHours = (): boolean => {
  const now = new Date();
  const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const hour = istTime.getHours();
  const day = istTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Monday to Friday (1-5), 9 AM to 6 PM
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
};

// Suspicious pattern detection
export const detectSuspiciousActivity = (actions: Array<{ timestamp: number; action: string; ip?: string }>): boolean => {
  const now = Date.now();
  const recentActions = actions.filter(action => now - action.timestamp < 300000); // Last 5 minutes
  
  // Multiple rapid requests
  if (recentActions.length > 50) return true;
  
  // Multiple IPs from same user
  const uniqueIPs = new Set(recentActions.map(action => action.ip).filter(Boolean));
  if (uniqueIPs.size > 3) return true;
  
  // Rapid failed attempts
  const failedActions = recentActions.filter(action => action.action.includes('failure'));
  if (failedActions.length > 10) return true;
  
  return false;
};