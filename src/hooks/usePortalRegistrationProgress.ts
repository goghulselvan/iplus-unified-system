import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PortalRegistrationProgress {
  studentCount: number;
  enrollmentCount: number;
  submittedTotal: number;
}

// Live counts for the portal registration journey — read even while the school's
// list is still in progress (not yet submitted/locked), so staff can see partial
// progress instead of a blank pending state.
export const usePortalRegistrationProgress = (schoolId?: string, projectId?: string) => {
  return useQuery({
    queryKey: ['portal-registration-progress', schoolId, projectId],
    queryFn: async (): Promise<PortalRegistrationProgress> => {
      const { data: students } = await supabase
        .from('portal_registered_students')
        .select('id')
        .eq('school_id', schoolId!)
        .eq('project_id', projectId!);
      const studentIds = (students ?? []).map(s => s.id);

      const [{ count: enrollmentCount }, { data: submissions }] = await Promise.all([
        studentIds.length
          ? supabase
              .from('portal_student_enrollments')
              .select('id', { count: 'exact', head: true })
              .in('student_id', studentIds)
          : Promise.resolve({ count: 0 } as any),
        supabase
          .from('portal_payment_submissions')
          .select('amount_paid')
          .eq('school_id', schoolId!)
          .eq('project_id', projectId!),
      ]);

      const submittedTotal = (submissions ?? []).reduce((sum, s: any) => sum + Number(s.amount_paid ?? 0), 0);

      return {
        studentCount: studentIds.length,
        enrollmentCount: enrollmentCount ?? 0,
        submittedTotal,
      };
    },
    enabled: !!schoolId && !!projectId,
    staleTime: 60 * 1000,
  });
};
