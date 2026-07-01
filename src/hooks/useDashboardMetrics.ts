import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface DashboardMetrics {
  total_schools: number;
  courier_sent: number;
  courier_returned: number;
  contacted_yes: number;
  contacted_no: number;
  registration_interested: number;
  registration_not_interested: number;
  consent_requested: number;
  consent_form_sent_total: number;
  consent_form_sent_physical: number;
  consent_form_sent_digital: number;
  registration_confirmed: number;
  registration_pending: number;
  registration_in_progress: number;
  name_list_received: number;
  name_list_uploaded: number;
  payment_received: number;
  question_paper_sent: number;
  answer_sheet_received: number;
  result_sent: number;
  brochure_physical_only: number;
  brochure_digital_sent: number;
  brochure_both_physical_digital: number;
  total_registrations?: number; // Added for dashboard display
}

export const useDashboardMetrics = (projectId?: string) => {
  return useQuery({
    queryKey: ['dashboard-metrics', projectId],
    queryFn: async (): Promise<DashboardMetrics> => {
      // Use the access-controlled function that respects regional permissions
      const { data, error } = await supabase.rpc('get_dashboard_metrics_by_project_with_access', {
        p_project_id: projectId || null
      });

      if (error) {
        console.error('Error fetching dashboard metrics:', error);
        throw error;
      }

      return data?.[0] || {
        total_schools: 0,
        courier_sent: 0,
        courier_returned: 0,
        contacted_yes: 0,
        contacted_no: 0,
        registration_interested: 0,
        registration_not_interested: 0,
        consent_requested: 0,
        consent_form_sent_total: 0,
        consent_form_sent_physical: 0,
        consent_form_sent_digital: 0,
        registration_confirmed: 0,
        registration_pending: 0, // Added for consistency
        registration_in_progress: 0,
        name_list_received: 0,
        name_list_uploaded: 0,
        payment_received: 0,
        question_paper_sent: 0,
        answer_sheet_received: 0,
        result_sent: 0,
        brochure_physical_only: 0,
        brochure_digital_sent: 0,
        brochure_both_physical_digital: 0,
      };
    },
    staleTime: 2 * 60 * 1000, // 2 minutes - balance freshness with performance
    gcTime: 15 * 60 * 1000, // 15 minutes cache for high concurrency
    refetchOnWindowFocus: false, // Prevent unnecessary refetches
    refetchOnMount: false, // Use cached data on mount
    refetchOnReconnect: false, // Don't refetch on reconnect
    retry: 1, // Single retry for faster failure
  });
};