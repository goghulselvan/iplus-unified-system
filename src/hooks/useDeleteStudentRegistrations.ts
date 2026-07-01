import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeleteRegistrationsParams {
  schoolId: string;
  /** student_registrations.id values (legacy registration-centric path) */
  specificStudentIds?: string[];
  /** students.id values (preferred student-centric path) */
  peopleIds?: string[];
}

export const useDeleteStudentRegistrations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ schoolId, specificStudentIds, peopleIds }: DeleteRegistrationsParams) => {
      const { data, error } = await supabase.rpc('delete_student_registrations_by_school', {
        p_school_id: schoolId,
        p_specific_student_ids: specificStudentIds || null,
        p_specific_people_ids: peopleIds || null,
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: (data: any) => {
      toast.success(data?.message || 'Student registrations deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      queryClient.invalidateQueries({ queryKey: ['schools'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
};
