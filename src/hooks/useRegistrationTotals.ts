import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RegistrationTotals {
  entered: number;      // every subject registration entered for the project
  paid: number;         // the ones the money received covers — what the old tile showed
  unpaid: number;       // entered minus paid
  amount_unpaid: number;
}

const EMPTY: RegistrationTotals = { entered: 0, paid: 0, unpaid: 0, amount_unpaid: 0 };

export const useRegistrationTotals = (projectId?: string) => {
  return useQuery({
    queryKey: ['registration-totals', projectId],
    queryFn: async (): Promise<RegistrationTotals> => {
      const { data, error } = await supabase.rpc('get_registration_totals' as any, { p_project_id: projectId });
      if (error) throw error;
      const row = (data as unknown as RegistrationTotals[])?.[0];
      return row
        ? {
            entered: Number(row.entered),
            paid: Number(row.paid),
            unpaid: Number(row.unpaid),
            amount_unpaid: Number(row.amount_unpaid),
          }
        : EMPTY;
    },
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};
