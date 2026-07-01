import JSZip from 'jszip';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { generateReceipt } from './receiptGenerator';
import { StudentRegistrationPdfGenerator } from './studentRegistrationPdfGenerator';
import { fetchAllStudentRegistrations } from '@/lib/supabaseUtils';

export interface ValidationResult {
  valid: number;
  fixable: Array<{
    ssNo: number;
    schoolName: string;
    issue: string;
  }>;
  unfixable: Array<{
    ssNo: number;
    schoolName: string;
    issue: string;
  }>;
}

export interface FailedSchool {
  ssNo: number;
  schoolName: string;
  error: string;
}

export interface GenerationReport {
  type: 'receipts' | 'registrations';
  totalSchools: number;
  successCount: number;
  failedCount: number;
  failedSchools: FailedSchool[];
  downloadedFileName: string;
  fileSize: string;
}

export type ProgressCallback = (current: number, total: number, schoolName: string) => void;

interface PaymentTransaction {
  id: string;
  payment_date: string;
  payment_amount: number;
  receipt_numbers: {
    receipt_number: number;
  } | null;
}

interface SchoolWithPayment {
  id: string;
  ss_no: number;
  school_name: string;
  payment_status: string;
  payment_transactions: PaymentTransaction[];
}

export async function validateReceiptData(projectId: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: 0,
    fixable: [],
    unfixable: []
  };

  // Fetch all schools with payment status 'Received' or 'Partial'
  const { data: schools, error: schoolsError } = await supabase
    .from('schools')
    .select(`
      id,
      ss_no,
      school_name,
      payment_status,
      payment_transactions (
        id,
        payment_date,
        payment_amount,
        receipt_numbers (
          receipt_number
        )
      )
    `)
    .eq('current_project_id', projectId)
    .in('payment_status', ['Received', 'Partial'])
    .order('ss_no');

  if (schoolsError) {
    console.error('Error fetching schools:', schoolsError);
    throw new Error('Failed to fetch school data');
  }

  if (!schools || schools.length === 0) {
    return result;
  }

  for (const school of schools) {
    const transactions = school.payment_transactions || [];
    
    if (transactions.length === 0) {
      result.unfixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: 'No payment transaction found'
      });
      continue;
    }

    // Use the latest payment transaction
    const latestTransaction = transactions[transactions.length - 1];
    
    // Check for missing receipt number
    if (!latestTransaction.receipt_numbers) {
      result.fixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: 'Missing receipt number (can auto-generate)'
      });
      continue;
    }

    // Check for invalid payment date
    if (!latestTransaction.payment_date) {
      result.unfixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: 'Invalid payment date'
      });
      continue;
    }

    // Check for zero or null payment amount
    if (!latestTransaction.payment_amount || latestTransaction.payment_amount <= 0) {
      result.unfixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: 'Invalid payment amount (zero or missing)'
      });
      continue;
    }

    result.valid++;
  }

  return result;
}

async function autoFixReceiptNumbers(projectId: string): Promise<void> {
  // Fetch schools with missing receipt numbers
  const { data: schools, error } = await supabase
    .from('schools')
    .select(`
      id,
      ss_no,
      payment_transactions (
        id,
        receipt_numbers (
          receipt_number
        )
      )
    `)
    .eq('current_project_id', projectId)
    .in('payment_status', ['Received', 'Partial']);

  if (error || !schools) {
    throw new Error('Failed to fetch schools for auto-fix');
  }

  for (const school of schools) {
    const transactions = school.payment_transactions || [];
    if (transactions.length === 0) continue;

    const latestTransaction = transactions[transactions.length - 1];
    
    if (!latestTransaction.receipt_numbers) {
      // Get next receipt number
      const { data: maxReceipt } = await supabase
        .from('receipt_numbers')
        .select('receipt_number')
        .order('receipt_number', { ascending: false })
        .limit(1)
        .single();

      const nextReceiptNumber = (maxReceipt?.receipt_number || 0) + 1;

      // Insert receipt number
      await supabase
        .from('receipt_numbers')
        .insert({
          payment_transaction_id: latestTransaction.id,
          receipt_number: nextReceiptNumber
        });
    }
  }
}

export async function generateAllPaymentReceiptsPdf(
  projectId: string,
  onProgress: ProgressCallback,
  autoFix: boolean = false
): Promise<GenerationReport> {
  if (autoFix) {
    await autoFixReceiptNumbers(projectId);
  }

  // Fetch all schools with valid receipt data
  const { data: schools, error } = await supabase
    .from('schools')
    .select(`
      id,
      ss_no,
      school_name,
      payment_transactions (
        id,
        payment_date,
        payment_amount,
        receipt_numbers (
          receipt_number
        )
      )
    `)
    .eq('current_project_id', projectId)
    .in('payment_status', ['Received', 'Partial'])
    .order('ss_no');

  if (error || !schools) {
    throw new Error('Failed to fetch schools for receipt generation');
  }

  const zip = new JSZip();
  let successCount = 0;
  const failedSchools: FailedSchool[] = [];

  const validSchools = schools.filter(school => {
    const transactions = school.payment_transactions || [];
    if (transactions.length === 0) return false;
    const latestTransaction = transactions[transactions.length - 1];
    return latestTransaction.receipt_numbers && 
           latestTransaction.payment_date &&
           latestTransaction.payment_amount > 0;
  });

  for (let i = 0; i < validSchools.length; i++) {
    const school = validSchools[i];
    onProgress(i + 1, validSchools.length, school.school_name);

    try {
      const latestTransaction = school.payment_transactions[school.payment_transactions.length - 1];
      const receiptNumber = latestTransaction.receipt_numbers!.receipt_number;

      const pdfBlob = await generateReceipt({
        receiptNumber: receiptNumber,
        ssNo: school.ss_no,
        schoolName: school.school_name,
        paymentDate: new Date(latestTransaction.payment_date),
        amount: latestTransaction.payment_amount
      });

      const fileName = `Receipt_${receiptNumber}_SSNo${String(school.ss_no).padStart(4, '0')}.pdf`;
      zip.file(fileName, pdfBlob);
      successCount++;
    } catch (error: any) {
      failedSchools.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        error: error.message || 'Unknown error'
      });
    }
  }

  // Generate ZIP file
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Trigger download
  const fileName = `Payment_Receipts_${format(new Date(), 'yyyy-MM-dd')}.zip`;
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  const fileSizeMB = (zipBlob.size / (1024 * 1024)).toFixed(2);

  return {
    type: 'receipts',
    totalSchools: validSchools.length,
    successCount,
    failedCount: failedSchools.length,
    failedSchools,
    downloadedFileName: fileName,
    fileSize: `${fileSizeMB} MB`
  };
}

export async function validateRegistrationData(projectId: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: 0,
    fixable: [],
    unfixable: []
  };

  // Fetch all schools with their student registrations
  const { data: schools, error } = await supabase
    .from('schools')
    .select(`
      id,
      ss_no,
      school_name,
      student_registrations!inner (
        id,
        registration_number_generated,
        student_name
      )
    `)
    .eq('current_project_id', projectId)
    .eq('student_registrations.project_id', projectId);

  if (error) {
    console.error('Error fetching schools:', error);
    throw new Error('Failed to fetch school data');
  }

  if (!schools || schools.length === 0) {
    return result;
  }

  // Group by school and check for missing registration numbers
  const schoolMap = new Map<string, {
    ss_no: number;
    school_name: string;
    registrations: any[];
  }>();

  for (const school of schools) {
    if (!schoolMap.has(school.id)) {
      schoolMap.set(school.id, {
        ss_no: school.ss_no,
        school_name: school.school_name,
        registrations: []
      });
    }
    schoolMap.get(school.id)!.registrations.push(...(school.student_registrations || []));
  }

  for (const [, school] of schoolMap) {
    if (school.registrations.length === 0) {
      result.unfixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: 'No student registrations found'
      });
      continue;
    }

    // Check for students with missing registration numbers
    const studentsWithoutRegNo = school.registrations.filter(
      reg => !reg.registration_number_generated || reg.registration_number_generated.trim() === ''
    );

    if (studentsWithoutRegNo.length > 0) {
      result.fixable.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        issue: `${studentsWithoutRegNo.length} student(s) missing registration numbers`
      });
    } else {
      result.valid++;
    }
  }

  return result;
}

// Auto-fix function to regenerate missing registration numbers
async function autoFixRegistrationNumbers(projectId: string): Promise<void> {
  // Fetch all schools with students missing registration numbers
  const { data: schools, error } = await supabase
    .from('schools')
    .select(`
      id,
      ss_no,
      student_registrations!inner (
        id,
        registration_number_generated
      )
    `)
    .eq('current_project_id', projectId)
    .eq('student_registrations.project_id', projectId);

  if (error || !schools) {
    throw new Error('Failed to fetch schools for auto-fix');
  }

  for (const school of schools) {
    const registrations = school.student_registrations || [];
    
    for (const registration of registrations) {
      if (!registration.registration_number_generated || registration.registration_number_generated.trim() === '') {
        // Trigger the database function to generate registration number
        // The trigger on student_registrations should automatically generate it
        await supabase
          .from('student_registrations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', registration.id);
      }
    }
  }
}

export async function generateAllStudentRegistrationsPdf(
  projectId: string,
  onProgress: ProgressCallback,
  autoFix: boolean = false
): Promise<GenerationReport> {
  if (autoFix) {
    await autoFixRegistrationNumbers(projectId);
  }
  // Fetch all schools with registrations
  const { data: schools, error: schoolsError } = await supabase
    .from('schools')
    .select('id, ss_no, school_name')
    .eq('current_project_id', projectId)
    .order('ss_no');

  if (schoolsError || !schools) {
    throw new Error('Failed to fetch schools');
  }

  const zip = new JSZip();
  let successCount = 0;
  const failedSchools: FailedSchool[] = [];
  let processedCount = 0;

  for (const school of schools) {
    try {
      // Fetch registrations for this school
      const registrationData = await fetchAllStudentRegistrations(projectId);
      const schoolRegistrations = registrationData.data.filter(
        (reg: any) => reg.school_id === school.id
      );

      if (schoolRegistrations.length === 0) {
        continue; // Skip schools with no registrations
      }

      processedCount++;
      onProgress(processedCount, schools.length, school.school_name);

      // Generate PDF using the generator directly
      const generator = new StudentRegistrationPdfGenerator();
      await generator.initialize();
      const pdfBytes = await generator.generatePDF(schoolRegistrations, school.school_name);

      const sanitizedSchoolName = school.school_name.replace(/[^a-z0-9]/gi, '_');
      const fileName = `Registrations_SSNo${String(school.ss_no).padStart(4, '0')}_${sanitizedSchoolName}.pdf`;
      zip.file(fileName, pdfBytes);
      successCount++;
    } catch (error: any) {
      failedSchools.push({
        ssNo: school.ss_no,
        schoolName: school.school_name,
        error: error.message || 'Unknown error'
      });
    }
  }

  if (successCount === 0) {
    throw new Error('No registrations found to generate PDFs');
  }

  // Generate ZIP file
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Trigger download
  const fileName = `Student_Registrations_${format(new Date(), 'yyyy-MM-dd')}.zip`;
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  const fileSizeMB = (zipBlob.size / (1024 * 1024)).toFixed(2);

  return {
    type: 'registrations',
    totalSchools: processedCount,
    successCount,
    failedCount: failedSchools.length,
    failedSchools,
    downloadedFileName: fileName,
    fileSize: `${fileSizeMB} MB`
  };
}
