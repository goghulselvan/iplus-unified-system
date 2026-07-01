import { supabase } from '@/integrations/supabase/client';

/**
 * Fetch ALL student registrations - Testing for PostgREST db-max-rows limit
 * This utility tests if there's a server-side limit preventing full data fetch
 */
export async function fetchAllStudentRegistrations(projectId: string) {
  console.log('🔥 Fetching ALL registrations with pagination for project:', projectId);
  
  try {
    let allRegistrations: any[] = [];
    let from = 0;
    const limit = 1000; // Keep at 1000 for pagination efficiency
    let hasMore = true;
    const seenIds = new Set<string>(); // Track unique IDs to prevent duplicates
    
    while (hasMore) {
      console.log(`📊 Fetching batch: ${from} to ${from + limit - 1}`);
      
      const { data: batchData, error, count } = await supabase
        .from('student_registrations')
        .select(`
          *,
          schools(id, ss_no, school_name),
          student_subjects(
            id,
            subject_id,
            olympiad_subjects(id, subject_name, subject_code)
          )
        `, { count: 'exact' })
        .eq('project_id', projectId)
        .order('id', { ascending: true }) // Use stable sort by ID to prevent duplicates
        .range(from, from + limit - 1);
      
      if (error) {
        console.error('❌ Error in paginated query:', error);
        throw new Error(`Paginated query failed: ${error.message}`);
      }
      
      const batchSize = batchData?.length || 0;
      console.log(`✅ Fetched batch of ${batchSize} records. Total so far: ${allRegistrations.length + batchSize}`);
      
      if (batchData && batchSize > 0) {
        // Deduplicate: only add records we haven't seen
        for (const record of batchData) {
          if (!seenIds.has(record.id)) {
            seenIds.add(record.id);
            allRegistrations.push(record);
          }
        }
      }
      
      // Check if we have more data to fetch
      hasMore = batchSize === limit;
      from += limit;
      
      // Safety check to prevent infinite loops
      if (from > 50000) {
        console.warn('⚠️ Safety limit reached, stopping pagination');
        break;
      }
    }
    
    console.log(`🎉 COMPLETE: Fetched ALL ${allRegistrations.length} registrations from student_registrations`);

    // Also pull portal-registered students and merge them in
    try {
      const [portalRes, subjectsRes] = await Promise.all([
        supabase
          .from('portal_registered_students')
          .select(`id, school_id, project_id, student_name, class_code, schools(id, ss_no, school_name), portal_student_enrollments(olympiad_code)`)
          .eq('project_id', projectId),
        supabase
          .from('olympiad_subjects')
          .select('id, subject_name, subject_code'),
      ]);

      if (!portalRes.error && portalRes.data?.length) {
        const subjectByCode = new Map((subjectsRes.data ?? []).map(s => [s.subject_code, s]));
        const existingIds = new Set(allRegistrations.map(r => r.id));

        const portalMapped = portalRes.data
          .filter(ps => !existingIds.has(ps.id))
          .map(ps => ({
            id: ps.id,
            school_id: ps.school_id,
            project_id: ps.project_id,
            student_name: ps.student_name,
            student_class: ps.class_code,
            registration_number: null,
            registration_number_generated: null,
            schools: ps.schools,
            student_subjects: ((ps.portal_student_enrollments ?? []) as { olympiad_code: string }[])
              .map(e => {
                const subj = subjectByCode.get(e.olympiad_code);
                return subj ? { subject_id: subj.id, olympiad_subjects: { id: subj.id, subject_name: subj.subject_name, subject_code: subj.subject_code } } : null;
              })
              .filter(Boolean),
          }));

        allRegistrations = [...allRegistrations, ...portalMapped];
        console.log(`🎉 After merging portal students: ${allRegistrations.length} total registrations`);
      }
    } catch (portalErr) {
      console.warn('⚠️ Could not load portal students for Olympiad Management:', portalErr);
    }

    return { data: allRegistrations, count: allRegistrations.length };

  } catch (error) {
    console.error('❌ Error fetching all registrations:', error);
    throw error;
  }
}

/**
 * Fetch student registrations for summary (minimal data) with pagination
 */
export async function fetchRegistrationsForSummary(projectId: string) {
  console.log('🔥 Fetching ALL summary registrations with pagination for project:', projectId);
  
  try {
    let allRegistrations: any[] = [];
    let from = 0;
    const limit = 1000; // Keep at 1000 for pagination efficiency
    let hasMore = true;
    const seenIds = new Set<string>(); // Track unique IDs to prevent duplicates
    
    while (hasMore) {
      console.log(`📊 Fetching summary batch: ${from} to ${from + limit - 1}`);
      
      const { data: batchData, error, count } = await supabase
        .from('student_registrations')
        .select(`
          id,
          school_id,
          schools!inner (
            id,
            ss_no,
            school_name
          ),
          student_subjects!inner (
            subject_id,
            olympiad_subjects (
              subject_code
            )
          )
        `, { count: 'exact' })
        .eq('project_id', projectId)
        .order('id', { ascending: true }) // Use stable sort by ID to prevent duplicates
        .range(from, from + limit - 1);
      
      if (error) {
        console.error('❌ Error in summary paginated query:', error);
        throw new Error(`Summary paginated query failed: ${error.message}`);
      }
      
      const batchSize = batchData?.length || 0;
      console.log(`✅ Fetched summary batch of ${batchSize} records. Total so far: ${allRegistrations.length + batchSize}`);
      
      if (batchData && batchSize > 0) {
        // Deduplicate: only add records we haven't seen
        for (const record of batchData) {
          if (!seenIds.has(record.id)) {
            seenIds.add(record.id);
            allRegistrations.push(record);
          }
        }
      }
      
      // Check if we have more data to fetch
      hasMore = batchSize === limit;
      from += limit;
      
      // Safety check to prevent infinite loops
      if (from > 50000) {
        console.warn('⚠️ Safety limit reached, stopping summary pagination');
        break;
      }
    }

    console.log(`🎉 SUMMARY COMPLETE: Fetched ALL ${allRegistrations.length} registrations for summary`);

    // Enrich each registration's `schools` object with per-project workflow values
    // (name_list_status, total_participants) so the dashboard reflects THIS project only.
    const uniqueSchoolIds = Array.from(new Set(allRegistrations.map(r => r.school_id)));
    if (uniqueSchoolIds.length > 0) {
      const { data: workflowRows, error: wfError } = await supabase
        .from('school_project_workflow')
        .select('school_id, name_list_status, total_participants')
        .eq('project_id', projectId)
        .in('school_id', uniqueSchoolIds);

      if (wfError) {
        console.warn('⚠️ Could not load per-project workflow rows:', wfError.message);
      } else {
        const wfMap = new Map<string, { name_list_status: string | null; total_participants: number | null }>();
        (workflowRows || []).forEach((w: any) => {
          wfMap.set(w.school_id, {
            name_list_status: w.name_list_status,
            total_participants: w.total_participants,
          });
        });
        allRegistrations.forEach((reg: any) => {
          const wf = wfMap.get(reg.school_id);
          if (reg.schools && wf) {
            reg.schools.name_list_status = wf.name_list_status ?? 'Pending';
            reg.schools.total_participants = wf.total_participants ?? 0;
          } else if (reg.schools) {
            reg.schools.name_list_status = reg.schools.name_list_status ?? 'Pending';
            reg.schools.total_participants = reg.schools.total_participants ?? 0;
          }
        });
      }
    }

    return { data: allRegistrations, count: allRegistrations.length };
    
  } catch (error) {
    console.error('❌ Error fetching summary registrations:', error);
    throw error;
  }
}