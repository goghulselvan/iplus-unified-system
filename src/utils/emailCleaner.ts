import { supabase } from '@/integrations/supabase/client';

export interface EmailCleaningResult {
  school_id: string;
  school_name: string;
  original_email: string;
  cleaned_email: string;
  issues_fixed: string[];
}

/**
 * Clean email address by fixing common typos
 * - Remove leading/trailing spaces
 * - Remove spaces within email
 * - Fix double dots
 * - Remove dots at boundaries
 */
export function cleanEmail(email: string): { cleaned: string; issues: string[] } {
  if (!email || typeof email !== 'string') {
    return { cleaned: email, issues: [] };
  }

  const issues: string[] = [];
  let cleaned = email;

  // Fix leading/trailing spaces
  if (cleaned !== cleaned.trim()) {
    issues.push('removed_leading_trailing_spaces');
    cleaned = cleaned.trim();
  }

  // Remove spaces within email (e.g., "email @ school.com" → "email@school.com")
  if (cleaned.includes(' ')) {
    issues.push('removed_internal_spaces');
    cleaned = cleaned.replace(/\s/g, '');
  }

  // Fix double dots (e.g., "email..name@school.com" → "email.name@school.com")
  if (cleaned.includes('..')) {
    issues.push('fixed_double_dots');
    cleaned = cleaned.replace(/\.+/g, '.');
  }

  // Remove dots at start/end
  if (cleaned.startsWith('.') || cleaned.endsWith('.')) {
    issues.push('removed_boundary_dots');
    cleaned = cleaned.replace(/^\.+|\.+$/g, '');
  }

  return { cleaned, issues };
}

/**
 * Auto-clean all schools with fixable email typos
 * Returns before/after comparison for manual review
 */
export async function autoCleanSchoolEmails(): Promise<EmailCleaningResult[]> {
  try {
    // Fetch all schools with emails that have typos
    const { data: schools, error: fetchError } = await supabase
      .from('schools')
      .select('id, school_name, email')
      .not('email', 'is', null);

    if (fetchError) throw fetchError;
    if (!schools || schools.length === 0) return [];

    const results: EmailCleaningResult[] = [];
    const updates: Array<{ id: string; email: string }> = [];

    // Identify and clean emails with typos
    schools.forEach((school) => {
      const email = school.email as string;
      if (!email || !email.trim()) return;

      const { cleaned, issues } = cleanEmail(email);

      // Only process if changes were made
      if (cleaned !== email && cleaned && cleaned.includes('@')) {
        results.push({
          school_id: school.id,
          school_name: school.school_name,
          original_email: email,
          cleaned_email: cleaned,
          issues_fixed: issues,
        });

        updates.push({
          id: school.id,
          email: cleaned,
        });
      }
    });

    // Apply updates to database
    if (updates.length > 0) {
      const { error: updateError } = await supabase
        .from('schools')
        .upsert(updates, { onConflict: 'id' });

      if (updateError) {
        console.error('Error updating cleaned emails:', updateError);
        throw updateError;
      }
    }

    return results;
  } catch (error) {
    console.error('Error in autoCleanSchoolEmails:', error);
    throw error;
  }
}

/**
 * Get a report of email cleaning results with summary stats
 */
export function generateCleaningReport(results: EmailCleaningResult[]): {
  total_cleaned: number;
  by_issue_type: Record<string, number>;
  schools: EmailCleaningResult[];
} {
  const by_issue_type: Record<string, number> = {};

  results.forEach((result) => {
    result.issues_fixed.forEach((issue) => {
      by_issue_type[issue] = (by_issue_type[issue] || 0) + 1;
    });
  });

  return {
    total_cleaned: results.length,
    by_issue_type,
    schools: results,
  };
}

/**
 * Validate cleaned emails to ensure they're in proper format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;

  const pattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(email);
}

/**
 * Get statistics on email quality in database
 */
export async function getEmailQualityStats(): Promise<{
  total_schools: number;
  with_email: number;
  valid_emails: number;
  emails_with_typos: number;
  invalid_emails: number;
  no_email: number;
}> {
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('email')
      .not('email', 'is', null);

    if (error) throw error;

    let valid_emails = 0;
    let emails_with_typos = 0;
    let invalid_emails = 0;

    data?.forEach((school) => {
      const email = school.email as string;
      if (!email || !email.trim()) {
        invalid_emails++;
        return;
      }

      const { cleaned, issues } = cleanEmail(email);

      if (issues.length > 0 && cleaned && isValidEmail(cleaned)) {
        emails_with_typos++;
      } else if (isValidEmail(email)) {
        valid_emails++;
      } else {
        invalid_emails++;
      }
    });

    // Get total schools count
    const { count } = await supabase
      .from('schools')
      .select('id', { count: 'exact', head: true });

    return {
      total_schools: count || 0,
      with_email: data?.length || 0,
      valid_emails,
      emails_with_typos,
      invalid_emails,
      no_email: (count || 0) - (data?.length || 0),
    };
  } catch (error) {
    console.error('Error getting email quality stats:', error);
    throw error;
  }
}
