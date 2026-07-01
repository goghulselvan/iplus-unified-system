import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchAllStudentRegistrations } from '@/lib/supabaseUtils';

export interface StudentRegistration {
  id: string;
  project_id: string;
  school_id: string;
  student_name: string;
  student_class: string;
  roll_number?: string;
  registration_number?: string;
  registration_number_generated?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  schools?: {
    id: string;
    ss_no: number;
    school_name: string;
  };
  student_subjects?: Array<{
    id: string;
    subject_id: string;
    olympiad_subjects: {
      id: string;
      subject_name: string;
      subject_code: string;
    };
  }>;
}

export const useStudentRegistrations = (projectId?: string, filters?: {
  schoolId?: string;
  subjectId?: string;
  studentClass?: string;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: ['student-registrations', projectId, filters], // Include filters in cache key
    queryFn: async (): Promise<StudentRegistration[]> => {
      if (!projectId) {
        console.log('❌ No project ID provided to useStudentRegistrations');
        return [];
      }

      console.log('🔄 Fetching student registrations for project', projectId, 'with filters:', filters);
      
      try {
        // Optimized limits for high-scale performance
        // School-specific queries: max 1000 to prevent timeouts
        // General queries: 50 items for faster loading
        const defaultLimit = filters?.schoolId ? 1000 : 50;
        let { data, error } = await supabase.rpc('get_student_registrations_filtered', {
          p_project_id: projectId,
          p_school_id: filters?.schoolId || null,
          p_subject_id: filters?.subjectId || null,
          p_student_class: filters?.studentClass || null,
          p_limit: filters?.limit || defaultLimit,
          p_offset: filters?.offset || 0,
        });

        // If RPC fails, fall back to direct query
        if (error || !data) {
          console.warn('⚠️ RPC function failed or returned no data, using direct query fallback:', error);
          
        let query = supabase
          .from('student_registrations')
          .select(`
            id,
            project_id,
            school_id,
            student_name,
            student_class,
            registration_number_generated,
            created_at,
            schools!inner(id, ss_no, school_name),
            student_subjects(
              id,
              subject_id,
              olympiad_subjects(id, subject_name, subject_code)
            )
          `)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });
          
          if (filters?.schoolId) query = query.eq('school_id', filters.schoolId);
          if (filters?.studentClass) query = query.eq('student_class', filters.studentClass);
          
          // Apply limit only if explicitly provided, otherwise fetch all for school detail pages
          const queryLimit = filters?.limit || (filters?.schoolId ? 10000 : 100);
          if (filters?.limit) query = query.limit(filters.limit);
          if (filters?.offset) query = query.range(filters.offset, (filters.offset || 0) + queryLimit - 1);
          
          const directResult = await query;
          
          if (directResult.error) {
            console.error('❌ Direct query also failed:', directResult.error);
            throw directResult.error;
          }
          
          // Transform direct query results
          return (directResult.data || []).map((row: any) => ({
            id: row.id,
            project_id: row.project_id,
            school_id: row.school_id,
            student_name: row.student_name,
            student_class: row.student_class,
            registration_number: row.registration_number_generated,
            registration_number_generated: row.registration_number_generated,
            created_at: row.created_at,
            created_by: '',
            updated_at: row.created_at,
            schools: row.schools,
            student_subjects: (row.student_subjects || []).map((ss: any) => ({
              id: ss.id,
              subject_id: ss.subject_id,
              olympiad_subjects: ss.olympiad_subjects,
            })),
          })) as StudentRegistration[];
        }

        // Transform RPC data to match expected format
        const transformedData = (data || []).map((row: any) => {
          // Parse subjects from jsonb array
          const subjects = Array.isArray(row.subjects) ? row.subjects : [];
          
          // Ensure registration_number_generated is properly set
          const regNumber = row.registration_number || row.registration_number_generated || null;
          
          return {
            id: row.id,
            project_id: row.project_id,
            school_id: row.school_id,
            student_name: row.student_name,
            student_class: row.student_class,
            registration_number: regNumber,
            registration_number_generated: regNumber,
            created_at: row.created_at,
            created_by: '',
            updated_at: row.created_at,
            schools: {
              id: row.school_id,
              school_name: row.school_name,
              ss_no: row.school_ss_no,
            },
            student_subjects: subjects.map((subj: any) => ({
              id: subj.id,
              subject_id: subj.id,
              olympiad_subjects: {
                id: subj.id,
                subject_name: subj.subject_name,
                subject_code: subj.subject_code || '',
              },
            })),
          };
        });

        console.log('✅ Fetched', transformedData.length, 'registrations');
        return transformedData as StudentRegistration[];
      } catch (error) {
        console.error('❌ Error in useStudentRegistrations:', error);
        throw error;
      }
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes cache - optimized for 2M registrations
    gcTime: 15 * 60 * 1000, // 15 minutes garbage collection
    refetchOnWindowFocus: false, // Critical for 300 concurrent users
    refetchOnMount: false, // Use cached data on remount
    refetchOnReconnect: false, // Don't refetch on reconnect to reduce load
    retry: 1, // Reduce retries for faster failure
  });
};

// Simplified fallback query  
async function fallbackQuery(projectId: string, filters?: {
  schoolId?: string;
  subjectId?: string;
  studentClass?: string;
}): Promise<StudentRegistration[]> {
  // Use the utility function to get ALL data
  console.log('🔥 Using fetchAllStudentRegistrations utility for project:', projectId);
  
  const { data } = await fetchAllStudentRegistrations(projectId);
  
  let filteredData = data;
  
  // Apply optional filters
  if (filters?.schoolId) {
    filteredData = filteredData.filter(reg => reg.school_id === filters.schoolId);
  }
  
  if (filters?.subjectId) {
    filteredData = filteredData.filter(reg => 
      reg.student_subjects?.some((ss: any) => ss.subject_id === filters.subjectId)
    );
  }
  
  if (filters?.studentClass) {
    filteredData = filteredData.filter(reg => reg.student_class === filters.studentClass);
  }
  
  console.log(`✅ Filtered to ${filteredData.length} registrations`);
  return filteredData;
}

export const useCreateStudentRegistration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      project_id: string;
      school_id: string;
      subject_ids: string[];
      student_name: string;
      student_class: string;
    }) => {
      const { getClassCode } = await import('@/utils/classCodeMapper');
      const classCodeInt = getClassCode(data.student_class);
      const classCode = String(classCodeInt).padStart(2, '0');

      // 1. Look up olympiad codes for the given subject IDs
      const { data: subjects, error: subjErr } = await supabase
        .from('olympiad_subjects')
        .select('id, subject_name, alphabetical_code')
        .in('id', data.subject_ids);
      if (subjErr) throw subjErr;

      // 2. Find or create portal_registered_students row for this student
      const name = data.student_name.trim();
      let studentId: string;

      const { data: existing } = await supabase
        .from('portal_registered_students')
        .select('id')
        .eq('project_id', data.project_id)
        .eq('school_id', data.school_id)
        .eq('class_code', classCode)
        .ilike('student_name', name)
        .maybeSingle();

      if (existing?.id) {
        studentId = existing.id;
      } else {
        const { data: newStudent, error: insErr } = await supabase
          .from('portal_registered_students')
          .insert({ project_id: data.project_id, school_id: data.school_id, student_name: name, class_code: classCode })
          .select('id')
          .single();
        if (insErr) throw insErr;
        studentId = newStudent.id;
      }

      // 3. Insert one enrollment per subject — submitted_at = now() so trigger fires
      const enrollments = (subjects ?? []).map((s) => ({
        student_id: studentId,
        olympiad_code: s.alphabetical_code ?? s.subject_name,
        submitted_at: new Date().toISOString(),
      }));

      const { error: enrollErr } = await supabase
        .from('portal_student_enrollments')
        .upsert(enrollments, { onConflict: 'student_id,olympiad_code' });
      if (enrollErr) throw enrollErr;

      return { studentId, subjects: subjects?.length ?? 0 };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      queryClient.invalidateQueries({ queryKey: ['portal-students'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      toast.success(`Student registered for ${result.subjects} subject(s)`);
    },
    onError: (error) => {
      toast.error('Failed to register student: ' + error.message);
    },
  });
};

export const useBulkCreateStudentRegistrations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (registrations: Array<{
      project_id: string;
      school_id: string;
      student_name: string;
      student_class: string;
      subject_ids: string[];
    }>) => {
      const { getClassCode } = await import('@/utils/classCodeMapper');

      // Pre-load all unique subject IDs in one query
      const allSubjectIds = [...new Set(registrations.flatMap((r) => r.subject_ids))];
      const { data: subjects, error: subjErr } = await supabase
        .from('olympiad_subjects')
        .select('id, subject_name, alphabetical_code')
        .in('id', allSubjectIds);
      if (subjErr) throw subjErr;

      const subjectMap = new Map(
        (subjects ?? []).map((s) => [s.id, s.alphabetical_code ?? s.subject_name])
      );

      // Build portal_registered_students rows (deduplicated by name+class+school+project)
      const uniqueStudents = new Map<string, { project_id: string; school_id: string; student_name: string; class_code: string }>();
      for (const reg of registrations) {
        const classCode = String(getClassCode(reg.student_class)).padStart(2, '0');
        const key = `${reg.project_id}::${reg.school_id}::${classCode}::${reg.student_name.trim().toLowerCase()}`;
        if (!uniqueStudents.has(key)) {
          uniqueStudents.set(key, {
            project_id: reg.project_id,
            school_id: reg.school_id,
            student_name: reg.student_name.trim(),
            class_code: classCode,
          });
        }
      }

      // Upsert all student rows at once
      const studentRows = [...uniqueStudents.values()];
      const { data: insertedStudents, error: studErr } = await supabase
        .from('portal_registered_students')
        .upsert(studentRows, { onConflict: 'school_id,project_id,class_code,student_name', ignoreDuplicates: false })
        .select('id, school_id, project_id, class_code, student_name');
      if (studErr) throw studErr;

      // Build a lookup: key → student id
      const studentIdMap = new Map<string, string>();
      for (const s of (insertedStudents ?? [])) {
        const key = `${s.project_id}::${s.school_id}::${s.class_code}::${s.student_name.toLowerCase()}`;
        studentIdMap.set(key, s.id);
      }

      // Build enrollment rows
      const enrollments: Array<{ student_id: string; olympiad_code: string; submitted_at: string }> = [];
      const now = new Date().toISOString();

      for (const reg of registrations) {
        const classCode = String(getClassCode(reg.student_class)).padStart(2, '0');
        const key = `${reg.project_id}::${reg.school_id}::${classCode}::${reg.student_name.trim().toLowerCase()}`;
        const studentId = studentIdMap.get(key);
        if (!studentId) continue;

        for (const subjectId of reg.subject_ids) {
          const olympiadCode = subjectMap.get(subjectId);
          if (!olympiadCode) continue;
          enrollments.push({ student_id: studentId, olympiad_code: olympiadCode, submitted_at: now });
        }
      }

      // Upsert enrollments — trigger fires per row and generates registration numbers
      const BATCH = 100;
      let written = 0;
      for (let i = 0; i < enrollments.length; i += BATCH) {
        const { error } = await supabase
          .from('portal_student_enrollments')
          .upsert(enrollments.slice(i, i + BATCH), { onConflict: 'student_id,olympiad_code' });
        if (error) throw error;
        written += Math.min(BATCH, enrollments.length - i);
      }

      return { students: studentRows.length, enrollments: written };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      queryClient.invalidateQueries({ queryKey: ['portal-students'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      toast.success(`${result.students} students, ${result.enrollments} subject registrations created`);
    },
    onError: (error) => {
      toast.error('Failed to register students: ' + error.message);
    },
  });
};

export const useUpdateStudentName = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      registrationId: string;
      studentName: string;
    }) => {
      const { error } = await supabase
        .from('student_registrations')
        .update({ student_name: data.studentName.trim() })
        .eq('id', data.registrationId);

      if (error) throw error;
    },
    onSuccess: () => {
      // Batch invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      toast.success('Student name updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update student name: ' + error.message);
    },
  });
};

export const useCorrectStudentRegistration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      registrationId: string;
      newClass?: string;
      newSubjectIds?: string[];
      reason?: string;
    }) => {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      
      const { data: result, error } = await supabase.rpc('correct_student_registration', {
        p_registration_id: data.registrationId,
        p_new_class: data.newClass || null,
        p_new_subject_ids: data.newSubjectIds || null,
        p_corrected_by: userId,
        p_correction_reason: data.reason || 'Data entry correction',
      });

      if (error) throw error;
      
      // Check if the function returned success
      if (result && result.length > 0 && !result[0].success) {
        throw new Error(result[0].message);
      }

      return result?.[0];
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      toast.success(`Registration corrected! New number: ${result?.new_registration_number}`);
    },
    onError: (error) => {
      toast.error('Failed to correct registration: ' + error.message);
    },
  });
};