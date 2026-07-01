import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Communication } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

export const useCommunications = (schoolId?: string) => {
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;

  const fetchCommunications = async () => {
    if (!schoolId) return;
    if (!projectId) {
      setCommunications([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('communications')
        .select(`
          *,
          profiles:user_id(username, full_name)
        `)
        .eq('school_id', schoolId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCommunications(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch communications',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addCommunication = async (
    schoolId: string,
    type: 'Phone' | 'Email' | 'WhatsApp',
    message: string,
    contactedPersonName?: string,
    contactedMobileNo?: string,
    designation?: string
  ) => {
    try {
      const user = await supabase.auth.getUser();
      const userId = user.data.user?.id;

      if (!userId) {
        throw new Error('User not authenticated');
      }

      if (!projectId) {
        throw new Error('No active project selected');
      }

      // Insert communication (project-scoped)
      const { data, error } = await supabase
        .from('communications')
        .insert({
          school_id: schoolId,
          user_id: userId,
          project_id: projectId,
          communication_type: type,
          message,
          contacted_person_name: contactedPersonName,
          contacted_mobile_no: contactedMobileNo,
          designation
        })
        .select()
        .single();

      if (error) throw error;

      // Update per-project contacted status (school_project_workflow)
      await supabase
        .from('school_project_workflow')
        .update({ contacted: 'Yes' })
        .eq('school_id', schoolId)
        .eq('project_id', projectId);

      // Log activity in activity_logs
      await supabase
        .from('activity_logs')
        .insert({
          school_id: schoolId,
          user_id: userId,
          project_id: projectId,
          activity_type: 'communication',
          description: `${type} communication logged: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`
        });

      // Mark any pending follow-ups for this school in THIS project as completed
      const { data: followUps } = await supabase
        .from('follow_ups')
        .select('id')
        .eq('school_id', schoolId)
        .eq('project_id', projectId)
        .eq('status', 'pending');

      if (followUps && followUps.length > 0) {
        await supabase
          .from('follow_ups')
          .update({ status: 'completed' })
          .eq('school_id', schoolId)
          .eq('project_id', projectId)
          .eq('status', 'pending');

        await supabase
          .from('activity_logs')
          .insert({
            school_id: schoolId,
            user_id: userId,
            project_id: projectId,
            activity_type: 'follow_up',
            description: 'Follow-up completed due to communication'
          });
      }

      if (schoolId) {
        await fetchCommunications();
      }

      toast({
        title: 'Success',
        description: 'Communication logged successfully'
      });

      return { data, error: null };
    } catch (error: any) {
      console.error('Error adding communication:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to log communication',
        variant: 'destructive',
      });
      return { data: null, error };
    }
  };

  useEffect(() => {
    fetchCommunications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, projectId]);

  return {
    communications,
    loading,
    fetchCommunications,
    addCommunication
  };
};

export const useAllCommunications = () => {
  const [communications, setCommunications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;

  const fetchAllCommunications = async (searchTerm?: string, limit?: number) => {
    if (!projectId) {
      setCommunications([]);
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('communications')
        .select(`
          *,
          schools (
            school_name,
            ss_no,
            district
          ),
          profiles (
            full_name,
            username
          )
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (searchTerm) {
        query = query.or(`message.ilike.%${searchTerm}%,contacted_person_name.ilike.%${searchTerm}%,contacted_mobile_no.ilike.%${searchTerm}%`);
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCommunications(data || []);
    } catch (error: any) {
      console.error('Error fetching communications:', error);
      setCommunications([]);
    } finally {
      setLoading(false);
    }
  };

  // Listen for custom events to update communications
  useEffect(() => {
    const handleCommunicationsUpdate = (event: any) => {
      setCommunications(event.detail);
    };

    window.addEventListener('communications-updated', handleCommunicationsUpdate);

    return () => {
      window.removeEventListener('communications-updated', handleCommunicationsUpdate);
    };
  }, []);

  return {
    communications,
    loading,
    fetchAllCommunications
  };
};
