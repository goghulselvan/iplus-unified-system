import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SchoolStudentParticipation {
  registration_id: string;
  subject_id: string;
  subject_name: string;
  subject_code: string;
  registration_number: string | null;
}

export interface SchoolStudent {
  student_id: string;
  student_name: string;
  student_class: string;
  class_code: number | null;
  student_sequence: number | null;
  created_at: string;
  participations: SchoolStudentParticipation[];
}

export const useSchoolStudents = (schoolId?: string, projectId?: string) => {
  return useQuery({
    queryKey: ['school-students', schoolId, projectId],
    queryFn: async (): Promise<SchoolStudent[]> => {
      if (!schoolId || !projectId) return [];

      const { data, error } = await supabase.rpc('get_school_students', {
        p_school_id: schoolId,
        p_project_id: projectId,
      });

      if (error) throw error;
      return (data || []) as unknown as SchoolStudent[];
    },
    enabled: !!schoolId && !!projectId,
    staleTime: 60 * 1000,
  });
};
