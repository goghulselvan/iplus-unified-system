import { supabase } from '@/integrations/supabase/client';
import { getClassCode } from '@/utils/classCodeMapper';

/**
 * Find or create a `students` row (one per real student per school+project+class).
 * Returns the student's UUID. Used so all subject participations of the same
 * student share the same trailing roll number in their registration numbers.
 */
export async function getOrCreateStudentId(params: {
  project_id: string;
  school_id: string;
  student_name: string;
  student_class: string;
  created_by: string;
}): Promise<string> {
  const name = params.student_name.trim();
  const cls = params.student_class.trim();
  const classCode = getClassCode(cls);
  const normalized = name.toLowerCase();

  // 1. Look up existing
  const { data: existing, error: lookupErr } = await supabase
    .from('students')
    .select('id')
    .eq('project_id', params.project_id)
    .eq('school_id', params.school_id)
    .eq('class_code', classCode)
    .eq('student_name_normalized', normalized)
    .maybeSingle();

  if (lookupErr) throw lookupErr;
  if (existing?.id) return existing.id;

  // 2. Compute next student_sequence for (school, project, class)
  const { data: maxRow, error: maxErr } = await supabase
    .from('students')
    .select('student_sequence')
    .eq('project_id', params.project_id)
    .eq('school_id', params.school_id)
    .eq('class_code', classCode)
    .order('student_sequence', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) throw maxErr;
  const nextSeq = (maxRow?.student_sequence ?? 0) + 1;

  // 3. Insert; on unique conflict (race), re-fetch.
  const { data: inserted, error: insertErr } = await supabase
    .from('students')
    .insert([{
      project_id: params.project_id,
      school_id: params.school_id,
      student_class: cls,
      class_code: classCode,
      student_name: name,
      student_sequence: nextSeq,
      created_by: params.created_by,
    }])
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // Race condition fallback — re-fetch
    const { data: retry } = await supabase
      .from('students')
      .select('id')
      .eq('project_id', params.project_id)
      .eq('school_id', params.school_id)
      .eq('class_code', classCode)
      .eq('student_name_normalized', normalized)
      .maybeSingle();
    if (retry?.id) return retry.id;
    throw insertErr;
  }

  return inserted!.id;
}
