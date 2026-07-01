import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OlympiadProject {
  id: string;
  project_name: string;
  project_year: number;
  is_active: boolean;
  brochure_url?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OlympiadSubject {
  id: string;
  project_id: string;
  subject_name: string;
  subject_code: string;
  alphabetical_code?: string;
  applicable_classes: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const useOlympiadProjects = () => {
  return useQuery({
    queryKey: ['olympiad-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('olympiad_projects')
        .select('*')
        .order('project_year', { ascending: false });

      if (error) throw error;
      return data as OlympiadProject[];
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - projects rarely change
    gcTime: 60 * 60 * 1000, // 60 minutes cache
    refetchOnWindowFocus: false,
  });
};

export const useActiveProject = () => {
  return useQuery({
    queryKey: ['active-project'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data, error } = await supabase
        .from('olympiad_projects')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return data as OlympiadProject | null;
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes - active project rarely changes
  });
};

export const useOlympiadSubjects = (projectId?: string, options?: { includeInactive?: boolean }) => {
  return useQuery({
    queryKey: ['olympiad-subjects', projectId, options?.includeInactive],
    queryFn: async () => {
      if (!projectId) return [];

      let query = supabase
        .from('olympiad_subjects')
        .select('*')
        .eq('project_id', projectId)
        .order('subject_code', { ascending: true });

      if (!options?.includeInactive) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) throw error;
      return data as OlympiadSubject[];
    },
    enabled: !!projectId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { project_name: string; project_year: number; brochure_url?: string }) => {
      const { data: result, error } = await supabase
        .from('olympiad_projects')
        .insert([{
          ...data,
          created_by: (await supabase.auth.getUser()).data.user?.id!,
        }])
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olympiad-projects'] });
      toast.success('Project created successfully');
    },
    onError: (error) => {
      toast.error('Failed to create project: ' + error.message);
    },
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string; project_name: string; project_year: number; brochure_url?: string }) => {
      const { id, ...updates } = data;
      const { data: result, error } = await supabase
        .from('olympiad_projects')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!result) throw new Error('Update failed — insufficient permissions or project not found.');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olympiad-projects'] });
      queryClient.invalidateQueries({ queryKey: ['active-project'] });
      toast.success('Project updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update project: ' + error.message);
    },
  });
};

export const useCreateSubject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      project_id: string;
      subject_name: string;
      subject_code: string;
      alphabetical_code?: string;
      applicable_classes: string[];
    }) => {
      const { data: result, error } = await supabase
        .from('olympiad_subjects')
        .insert([data])
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olympiad-subjects'] });
      toast.success('Subject created successfully');
    },
    onError: (error) => {
      toast.error('Failed to create subject: ' + error.message);
    },
  });
};

export const useUpdateSubject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      subject_name: string;
      subject_code: string;
      alphabetical_code?: string;
      applicable_classes: string[];
      is_active: boolean;
    }) => {
      const { id, ...updates } = data;
      const { data: result, error } = await supabase
        .from('olympiad_subjects')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!result) throw new Error('Update failed — insufficient permissions or subject not found.');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olympiad-subjects'] });
      queryClient.invalidateQueries({ queryKey: ['registration-summary'] });
      toast.success('Subject updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update subject: ' + error.message);
    },
  });
};

export const useSetActiveProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      // Single atomic RPC: deactivates others, activates target,
      // ensures workflow rows, rehydrates schools mirror — all under
      // mirror mode so audit triggers don't fire.
      const { error } = await supabase.rpc('switch_active_project', {
        p_project_id: projectId,
      });

      if (error) throw error;
      return projectId;
    },
    onSuccess: () => {
      // Invalidate every project-scoped cache so the UI repaints with
      // the active project's numbers.
      queryClient.invalidateQueries({ queryKey: ['olympiad-projects'] });
      queryClient.invalidateQueries({ queryKey: ['active-project'] });
      queryClient.invalidateQueries({ queryKey: ['schools'] });
      queryClient.invalidateQueries({ queryKey: ['schools-paginated'] });
      queryClient.invalidateQueries({ queryKey: ['school-filter-options'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
      queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['payment-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accountant-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['project-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['school-workflow'] });
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      queryClient.invalidateQueries({ queryKey: ['registration-summary'] });
      toast.success('Active project switched. Dashboard and lists now reflect the active project.');
    },
    onError: (error) => {
      toast.error('Failed to switch active project: ' + error.message);
    },
  });
};