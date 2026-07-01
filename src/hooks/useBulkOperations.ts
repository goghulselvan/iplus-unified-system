import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BulkRegistrationData {
  project_id: string;
  school_id: string;
  student_name: string;
  /** Class label as stored in DB: '1'–'12', 'LKG', 'UKG' */
  student_class: string;
  /** Olympiad code, e.g. 'EPO', 'ESO' */
  olympiad_code: string;
}

const BATCH_SIZE = 50; // Optimal batch size for Supabase

/**
 * Convert a numeric class code (as string) back to the label expected by
 * bulk_register_students_portal.  If the value is already a label ('LKG',
 * 'UKG', '1'…'12') it is returned unchanged.
 */
function classCodeToLabel(code: string): string {
  if (code === '14') return 'LKG';
  if (code === '15') return 'UKG';
  const n = parseInt(code, 10);
  if (!isNaN(n)) return String(n); // '01' → '1'
  return code; // already a label
}

/**
 * Optimized bulk registration hook — routes writes through
 * bulk_register_students_portal RPC (avoids blocked student_registrations table).
 * Designed for high-volume scenarios (2M+ registrations).
 */
export const useOptimizedBulkRegistrations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (registrations: BulkRegistrationData[]) => {
      if (registrations.length === 0) return { successCount: 0, errorCount: 0, errors: [] };

      // All records in this hook share the same project_id / school_id
      const { project_id: projectId, school_id: schoolId } = registrations[0];

      const rpcRegistrations = registrations.map(reg => ({
        student_name: reg.student_name.trim(),
        class: classCodeToLabel(reg.student_class.trim()),
        olympiad: reg.olympiad_code.trim(),
      }));

      const totalRecords = rpcRegistrations.length;
      const errors: string[] = [];
      let successCount = 0;

      // Process in batches
      for (let i = 0; i < rpcRegistrations.length; i += BATCH_SIZE) {
        const batch = rpcRegistrations.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
          const { data, error } = await supabase.rpc('bulk_register_students_portal', {
            p_school_id: schoolId,
            p_project_id: projectId,
            p_registrations: batch,
          });

          if (error) {
            console.error('Batch registration error:', error);
            errors.push(`Batch ${batchNum} failed: ${error.message}`);
            continue;
          }

          successCount += (data as unknown[])?.length ?? batch.length;

          // Log progress for large uploads
          const processedCount = i + batch.length;
          if (totalRecords > 100 && processedCount % 100 === 0) {
            console.log(`Bulk upload progress: ${processedCount}/${totalRecords} (${Math.round(processedCount / totalRecords * 100)}%)`);
          }
        } catch (err) {
          console.error('Batch processing error:', err);
          errors.push(`Batch ${batchNum} exception: ${err}`);
        }
      }

      if (errors.length > 0 && successCount === 0) {
        throw new Error(`All batches failed: ${errors.join('; ')}`);
      }

      return {
        successCount,
        errorCount: totalRecords - successCount,
        errors,
      };
    },
    onSuccess: (result) => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });

      if (result.errorCount > 0) {
        toast.warning(`Partially completed: ${result.successCount} successful, ${result.errorCount} failed`);
      } else {
        toast.success(`${result.successCount} registrations created successfully`);
      }
    },
    onError: (error: Error) => {
      toast.error('Bulk registration failed: ' + error.message);
    },
  });
};

/**
 * Optimized bulk deletion with batched operations
 */
export const useOptimizedBulkDeletion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (registrationIds: string[]) => {
      if (registrationIds.length === 0) return { deletedCount: 0 };

      let deletedCount = 0;
      const errors: string[] = [];

      // Process deletions in batches
      for (let i = 0; i < registrationIds.length; i += BATCH_SIZE) {
        const batch = registrationIds.slice(i, i + BATCH_SIZE);
        
        try {
          // Delete subject associations first
          const { error: subjectError } = await supabase
            .from('student_subjects')
            .delete()
            .in('registration_id', batch);

          if (subjectError) {
            console.error('Batch subject deletion error:', subjectError);
          }

          // Delete registrations
          const { error: regError, count } = await supabase
            .from('student_registrations')
            .delete()
            .in('id', batch);

          if (regError) {
            errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${regError.message}`);
          } else {
            deletedCount += count || batch.length;
          }
        } catch (error) {
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} exception`);
        }
      }

      return { deletedCount, errors };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      
      toast.success(`${result.deletedCount} registrations deleted`);
    },
    onError: (error: Error) => {
      toast.error('Bulk deletion failed: ' + error.message);
    },
  });
};

/**
 * Hook for RPC-based bulk operations (uses database function for atomic operations).
 * Routes through bulk_register_students_portal to avoid the blocked
 * student_registrations table.
 */
export const useAtomicBulkRegistration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      schoolId: string;
      registrations: Array<{
        student_name: string;
        /** Class label: '1'–'12', 'LKG', 'UKG' */
        student_class: string;
        /** Olympiad codes, e.g. ['EPO', 'ESO'] */
        subject_codes: string[];
      }>;
    }) => {
      // Flatten: one entry per (student, olympiad) pair as required by the RPC
      const rpcRegistrations = data.registrations.flatMap(reg =>
        reg.subject_codes.map(olympiadCode => ({
          student_name: reg.student_name,
          class: classCodeToLabel(reg.student_class.trim()),
          olympiad: olympiadCode,
        }))
      );

      const { data: result, error } = await supabase.rpc('bulk_register_students_portal', {
        p_school_id: data.schoolId,
        p_project_id: data.projectId,
        p_registrations: rpcRegistrations,
      });

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });

      toast.success('Bulk registration completed successfully');
    },
    onError: (error: Error) => {
      toast.error('Bulk registration failed: ' + error.message);
    },
  });
};
