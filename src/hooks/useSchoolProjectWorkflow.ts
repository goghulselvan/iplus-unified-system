import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useActiveProject } from './useOlympiadProjects';

export interface SchoolProjectWorkflow {
  id: string;
  school_id: string;
  project_id: string;
  contacted: 'Yes' | 'No';
  registration_interest: 'Interested' | 'Not Interested' | null;
  registration_interest_comment: string | null;
  consent_form_requested: 'Yes' | 'No';
  consent_form_comment: string | null;
  consent_form_sent: string | null;
  registration_status: 'Pending' | 'Confirmed' | 'In Progress';
  name_list_status: 'Pending' | 'Received' | 'Uploaded';
  brochure_delivery_status: 'Physical Only' | 'Digital Sent' | 'Both Physical & Digital';
  courier_status: 'Sent' | 'Returned';
  question_paper_sent: 'Sent' | 'Not Sent';
  answer_sheet_status: 'Waiting' | 'Received';
  result_status: 'Sent' | 'Not Sent';
  payment_status: 'Pending' | 'Received' | 'Partial';
  payment_date: string | null;
  payment_amount: number | null;
  payment_mode: string | null;
  payment_received: number;
  expected_amount: number;
  outstanding_balance: number | null;
  per_entry_rate: number;
  concession_per_entry: number;
  effective_rate_per_entry: number | null;
  total_participants: number | null;
  created_at: string;
  updated_at: string;
}

// Get workflow for a specific school in active project
export const useSchoolWorkflow = (schoolId?: string) => {
  const { data: activeProject } = useActiveProject();

  return useQuery({
    queryKey: ['school-workflow', schoolId, activeProject?.id],
    queryFn: async () => {
      if (!schoolId || !activeProject?.id) return null;

      const { data, error } = await supabase
        .from('school_project_workflow')
        .select('*')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject.id)
        .maybeSingle();

      if (error) throw error;
      return data as SchoolProjectWorkflow | null;
    },
    enabled: !!schoolId && !!activeProject?.id,
    staleTime: 5 * 60 * 1000,
  });
};

// Get all workflows for active project (for dashboard metrics)
export const useProjectWorkflows = () => {
  const { data: activeProject } = useActiveProject();

  return useQuery({
    queryKey: ['project-workflows', activeProject?.id],
    queryFn: async () => {
      if (!activeProject?.id) return [];

      const { data, error } = await supabase
        .from('school_project_workflow')
        .select('*')
        .eq('project_id', activeProject.id);

      if (error) throw error;
      return data as SchoolProjectWorkflow[];
    },
    enabled: !!activeProject?.id,
    staleTime: 2 * 60 * 1000,
  });
};

// Update workflow for a school
export const useUpdateSchoolWorkflow = () => {
  const queryClient = useQueryClient();
  const { data: activeProject } = useActiveProject();

  return useMutation({
    mutationFn: async ({ 
      schoolId, 
      updates 
    }: { 
      schoolId: string; 
      updates: Partial<SchoolProjectWorkflow>;
    }) => {
      if (!activeProject?.id) {
        throw new Error('No active project');
      }

      const { data, error } = await supabase
        .from('school_project_workflow')
        .update(updates)
        .eq('school_id', schoolId)
        .eq('project_id', activeProject.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['school-workflow', variables.schoolId] });
      queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error) => {
      toast.error('Failed to update workflow: ' + error.message);
    },
  });
};

// Ensure workflow exists for a school (creates if missing)
export const useEnsureSchoolWorkflow = () => {
  const { data: activeProject } = useActiveProject();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (schoolId: string) => {
      if (!activeProject?.id) {
        throw new Error('No active project');
      }

      // Check if workflow exists
      const { data: existing } = await supabase
        .from('school_project_workflow')
        .select('id')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject.id)
        .maybeSingle();

      if (existing) {
        return existing;
      }

      // Create new workflow record
      const { data, error } = await supabase
        .from('school_project_workflow')
        .insert({
          school_id: schoolId,
          project_id: activeProject.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, schoolId) => {
      queryClient.invalidateQueries({ queryKey: ['school-workflow', schoolId] });
    },
  });
};
