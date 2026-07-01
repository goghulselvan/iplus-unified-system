import { supabase } from '@/integrations/supabase/client';

export interface ReportFilters {
  schoolIds: string[];
  subjectIds: string[];
  classes: string[];
  districts: string[];
  states: string[];
  boards: string[];
  nameListStatus: string[];
}

export interface SchoolReportRow {
  ss_no: number;
  school_name: string;
  district: string;
  state: string | null;
  board: string;
  contact_person_name: string | null;
  mobile1: string | null;
  mobile2: string | null;
  email: string | null;
  total_participants: number;
  payment_status: string | null;
  name_list_status: string | null;
  // Class-wise counts
  lkg_count?: number;
  ukg_count?: number;
  class_1_count?: number;
  class_2_count?: number;
  class_3_count?: number;
  class_4_count?: number;
  class_5_count?: number;
  class_6_count?: number;
  class_7_count?: number;
  class_8_count?: number;
  // Subject-wise counts
  [key: string]: any;
}

export interface StudentReportRow {
  registration_number: string | null;
  student_name: string;
  student_class: string;
  subject_name: string;
  subject_code: string;
  roll_number: string | null;
  school_name: string;
  ss_no: number;
  district: string;
  state: string | null;
}

export type ReportType = 'schools_summary' | 'schools_classwise' | 'schools_subjectwise' | 'student_registrations' | 'custom';

// Fetch all schools with basic info - only confirmed registrations
export async function fetchSchoolsForReport(projectId: string, filters: ReportFilters): Promise<any[]> {
  let query = supabase
    .from('schools')
    .select('id, ss_no, school_name, district, state, board, contact_person_name, mobile1, mobile2, email, total_participants, payment_status, name_list_status, current_project_id')
    .eq('registration_status', 'Confirmed')
    .order('ss_no');

  // Apply filters
  if (filters.schoolIds.length > 0) {
    query = query.in('id', filters.schoolIds);
  }
  if (filters.districts.length > 0) {
    query = query.in('district', filters.districts);
  }
  if (filters.states.length > 0) {
    query = query.in('state', filters.states);
  }
  if (filters.boards.length > 0) {
    query = query.in('board', filters.boards);
  }
  if (filters.nameListStatus.length > 0) {
    query = query.in('name_list_status', filters.nameListStatus as ("Pending" | "Received" | "Uploaded")[]);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Fetch student registrations with all related data
const OLYMPIAD_LABELS_REPORT: Record<string, string> = {
  EPO: 'English Plus Olympiad',
  MPO: 'Maths Plus Olympiad',
  SPO: 'Science Plus Olympiad',
  GKSSPO: "GK & Social Science Plus",
  LRPO: 'Logical Reasoning Plus',
  KidsPO: "Kids Plus Olympiad",
};

const CLASS_LABELS_REPORT: Record<string, string> = {
  '14': 'LKG', '15': 'UKG',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1).padStart(2, '0'), `Class ${i + 1}`])),
};

export async function fetchStudentRegistrationsForReport(
  projectId: string,
  filters: ReportFilters
): Promise<StudentReportRow[]> {
  let query = supabase
    .from('portal_registered_students')
    .select(`
      id,
      student_name,
      class_code,
      school_id,
      schools(ss_no, school_name, district, state),
      portal_student_enrollments(olympiad_code)
    `)
    .eq('project_id', projectId);

  if (filters.schoolIds.length > 0) {
    query = query.in('school_id', filters.schoolIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows: StudentReportRow[] = [];
  for (const student of data ?? []) {
    const school = student.schools as unknown as { ss_no: number; school_name: string; district: string; state: string | null } | null;
    if (!school) continue;
    if (filters.districts.length > 0 && !filters.districts.includes(school.district)) continue;
    if (filters.states.length > 0 && school.state && !filters.states.includes(school.state)) continue;

    const enrollments = (student.portal_student_enrollments as { olympiad_code: string }[]) ?? [];
    const classLabel = CLASS_LABELS_REPORT[student.class_code] ?? student.class_code;

    for (const e of enrollments) {
      rows.push({
        registration_number: null,
        student_name: student.student_name,
        student_class: classLabel,
        subject_name: OLYMPIAD_LABELS_REPORT[e.olympiad_code] ?? e.olympiad_code,
        subject_code: e.olympiad_code,
        roll_number: null,
        school_name: school.school_name,
        ss_no: school.ss_no,
        district: school.district,
        state: school.state,
      });
    }
  }

  return rows;
}

// Map portal class_code to the short key used in classCounts
function portalClassCodeToKey(classCode: string): string {
  if (classCode === '14') return 'LKG';
  if (classCode === '15') return 'UKG';
  return String(parseInt(classCode, 10)); // '01' → '1', '09' → '9'
}

// Fetch class-wise and subject-wise counts for schools from portal tables
export async function fetchSchoolBreakdownCounts(
  projectId: string,
  schoolIds: string[],
  subjects: { id: string; subject_name: string; subject_code: string }[]
): Promise<Map<string, { classCounts: Record<string, number>; subjectCounts: Record<string, number> }>> {
  const countsMap = new Map<string, { classCounts: Record<string, number>; subjectCounts: Record<string, number> }>();

  for (const id of schoolIds) {
    countsMap.set(id, {
      classCounts: { LKG: 0, UKG: 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
      subjectCounts: Object.fromEntries(subjects.map(s => [s.subject_code, 0])),
    });
  }

  if (schoolIds.length === 0) return countsMap;

  const { data: students, error } = await supabase
    .from('portal_registered_students')
    .select('school_id, class_code, portal_student_enrollments(olympiad_code)')
    .eq('project_id', projectId)
    .in('school_id', schoolIds);

  if (error) throw error;

  for (const student of students ?? []) {
    const schoolData = countsMap.get(student.school_id);
    if (!schoolData) continue;

    const classKey = portalClassCodeToKey(student.class_code);
    if (classKey in schoolData.classCounts) schoolData.classCounts[classKey]++;

    for (const e of (student.portal_student_enrollments as { olympiad_code: string }[]) ?? []) {
      if (e.olympiad_code in schoolData.subjectCounts) schoolData.subjectCounts[e.olympiad_code]++;
    }
  }

  return countsMap;
}

// Generate CSV from data
export function generateCSV(data: any[], columns: { key: string; label: string }[]): string {
  if (data.length === 0) return '';

  // Header row
  const header = columns.map(col => `"${col.label}"`).join(',');
  
  // Data rows
  const rows = data.map(row => {
    return columns.map(col => {
      const value = row[col.key];
      if (value === null || value === undefined) return '""';
      if (typeof value === 'string') {
        // Escape double quotes and wrap in quotes
        return `"${value.replace(/"/g, '""')}"`;
      }
      return `"${value}"`;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

// Download CSV file
export function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Log export action for audit
export async function logExportAction(
  tableName: string,
  recordCount: number,
  exportReason: string
) {
  try {
    const { data: user } = await supabase.auth.getUser();
    if (!user?.user?.id) return;

    await supabase.from('security_audit_logs').insert({
      user_id: user.user.id,
      action: 'DATA_EXPORT',
      table_name: tableName,
      new_values: {
        export_type: 'advanced_export_module',
        record_count: recordCount,
        export_reason: exportReason,
        exported_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Failed to log export action:', error);
  }
}
