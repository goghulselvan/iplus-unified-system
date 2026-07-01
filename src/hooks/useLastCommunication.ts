import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

interface LastCommunication {
  school_id: string;
  latest_communication: {
    id: string;
    communication_type: string;
    message: string;
    created_at: string;
    contacted_person_name?: string;
    contacted_mobile_no?: string;
    profiles?: {
      username: string;
      full_name?: string;
    };
  } | null;
}

export const useLastCommunication = (schoolIds: string[]) => {
  const [lastCommunications, setLastCommunications] = useState<Record<string, LastCommunication['latest_communication']>>({});
  const [loading, setLoading] = useState(true);
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;

  const fetchLastCommunications = async () => {
    if (schoolIds.length === 0 || !projectId) {
      setLastCommunications({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch the latest communication for each school
      const communicationsPromises = schoolIds.map(async (schoolId) => {
        const { data, error } = await supabase
          .from('communications')
          .select(`
            id,
            communication_type,
            message,
            created_at,
            contacted_person_name,
            contacted_mobile_no,
            profiles (
              username,
              full_name
            )
          `)
          .eq('school_id', schoolId)
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(`Error fetching last communication for school ${schoolId}:`, error);
          return { schoolId, communication: null };
        }

        return { schoolId, communication: data };
      });

      const results = await Promise.all(communicationsPromises);
      
      const communicationsMap: Record<string, LastCommunication['latest_communication']> = {};
      results.forEach(({ schoolId, communication }) => {
        communicationsMap[schoolId] = communication;
      });

      setLastCommunications(communicationsMap);
    } catch (error) {
      console.error('Error fetching last communications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLastCommunications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIds.join(','), projectId]);

  // Set up real-time subscription for communications
  useEffect(() => {
    if (schoolIds.length === 0) return;

    const channel = supabase
      .channel('communications_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'communications',
          filter: `school_id=in.(${schoolIds.join(',')})`
        },
        (payload) => {
          // console.log('Communication real-time update:', payload);
          // Refresh communications when any change occurs for these schools
          fetchLastCommunications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [schoolIds.join(','), projectId]);

  return {
    lastCommunications,
    loading,
    refreshLastCommunications: fetchLastCommunications
  };
};