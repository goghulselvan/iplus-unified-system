import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface PaymentTransaction {
  id: string;
  school_id: string;
  payment_date: string;
  payment_amount: number;
  payment_mode: string;
  transaction_reference?: string;
  notes?: string;
  created_at: string;
  receipt_number?: number;
  receipt_fy?: number;
}

/**
 * Optimized hook to fetch paginated payment transactions for a school
 * Uses server-side pagination for better performance with large datasets
 */
export const usePaymentTransactions = (
  schoolId: string,
  options?: {
    limit?: number;
    offset?: number;
    enabled?: boolean;
  }
) => {
  return useQuery({
    queryKey: ['payment-transactions', schoolId, options?.limit, options?.offset],
    queryFn: async () => {
      if (!schoolId) return [];

      // Use optimized RPC function with server-side pagination
      const { data, error } = await supabase.rpc('get_payment_transactions_paginated', {
        p_school_id: schoolId,
        p_limit: options?.limit || 50,
        p_offset: options?.offset || 0,
      });

      if (error) {
        console.error('Error fetching payment transactions:', error);
        throw error;
      }

      return (data || []) as PaymentTransaction[];
    },
    enabled: options?.enabled !== false && !!schoolId,
    staleTime: 2 * 60 * 1000, // 2 minutes cache
    gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
    refetchOnWindowFocus: false,
  });
};
