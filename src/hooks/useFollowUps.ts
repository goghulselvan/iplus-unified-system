import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FollowUp } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

export const useFollowUps = () => {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef(false);

  // Debounced fetch function to prevent multiple rapid calls
  const debouncedFetchFollowUps = useCallback(async (delay = 300) => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    fetchTimeoutRef.current = setTimeout(async () => {
      if (isFetchingRef.current) {
        return;
      }

      if (!projectId) {
        setFollowUps([]);
        setLoading(false);
        return;
      }

      isFetchingRef.current = true;

      try {
        const { data, error } = await supabase
          .from('follow_ups')
          .select(`
            *,
            schools!inner (
              id,
              ss_no,
              school_name,
              school_address,
              district,
              board,
              contact_person_name,
              mobile1,
              mobile2,
              email,
              registration_status,
              registration_interest,
              contacted,
              courier_status,
              consent_form_requested,
              payment_status,
              question_paper_sent,
              answer_sheet_status,
              result_status
            )
          `)
          .eq('project_id', projectId)
          .eq('status', 'pending')
          .order('follow_up_date', { ascending: true })
          .order('follow_up_time', { ascending: true });

        if (error) {
          if (!error.message.includes('Failed to fetch')) {
            console.error('Error fetching follow-ups:', error);
            toast({
              title: 'Error',
              description: 'Failed to fetch follow-ups',
              variant: 'destructive',
            });
          }
          return;
        }

        setFollowUps((data || []) as FollowUp[]);
      } catch (error: any) {
        if (!error.message?.includes('Failed to fetch')) {
          console.error('Error fetching follow-ups:', error);
        }
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    }, delay);
  }, [toast, projectId]);

  const fetchFollowUps = useCallback(() => {
    return debouncedFetchFollowUps(0);
  }, [debouncedFetchFollowUps]);

  const getTodayAndOverdueFollowUps = () => {
    const today = new Date().toISOString().split('T')[0];
    return followUps.filter(followUp => followUp.follow_up_date <= today);
  };

  const createFollowUp = async (schoolId: string, date: string, time: string) => {
    try {
      if (!projectId) {
        throw new Error('No active project selected');
      }
      const userId = (await supabase.auth.getUser()).data.user?.id || '';

      const { data, error } = await supabase
        .from('follow_ups')
        .insert({
          school_id: schoolId,
          project_id: projectId,
          follow_up_date: date,
          follow_up_time: time,
          created_by: userId
        })
        .select()
        .single();

      if (error) {
        console.error('Follow-up creation error:', error);
        throw error;
      }

      await supabase
        .from('activity_logs')
        .insert({
          school_id: schoolId,
          user_id: userId,
          project_id: projectId,
          activity_type: 'follow_up',
          description: `Follow-up scheduled for ${date} at ${time}`
        });

      toast({
        title: 'Success',
        description: 'Follow-up scheduled successfully'
      });

      return { data, error: null };
    } catch (error: any) {
      console.error('Follow-up creation failed:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { data: null, error };
    }
  };

  const updateFollowUpStatus = async (id: string, status: 'completed' | 'rescheduled') => {
    try {
      const { error } = await supabase
        .from('follow_ups')
        .update({ status })
        .eq('id', id);

      if (error) throw error;

      await fetchFollowUps();
      toast({
        title: 'Success',
        description: `Follow-up marked as ${status}`
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const deleteFollowUp = async (id: string) => {
    try {
      const { error } = await supabase
        .from('follow_ups')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Follow-up deleted successfully'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Auto-refresh follow-ups and set up real-time updates (re-runs when project changes)
  useEffect(() => {
    debouncedFetchFollowUps(100);

    if (!projectId) return;

    const channel = supabase
      .channel(`follow_ups_realtime_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'follow_ups',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          debouncedFetchFollowUps(500);
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      debouncedFetchFollowUps(1000);
    }, 60000);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [debouncedFetchFollowUps, projectId]);

  return {
    followUps,
    loading,
    fetchFollowUps,
    getTodayAndOverdueFollowUps,
    createFollowUp,
    updateFollowUpStatus,
    deleteFollowUp,
    refreshFollowUps: fetchFollowUps
  };
};
