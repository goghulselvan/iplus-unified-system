import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

type TableName =
  | 'student_registrations'
  | 'student_subjects'
  | 'students'
  | 'schools'
  | 'school_project_workflow'
  | 'payment_transactions'
  | 'communications'
  | 'follow_ups'
  | 'portal_registered_students'
  | 'portal_student_enrollments';

interface RealtimeSyncOptions {
  tables?: TableName[];
  projectId?: string;
  debounceMs?: number;
}

// Debounce utility for high-frequency updates
const createDebouncer = (delay: number) => {
  const pending = new Map<string, NodeJS.Timeout>();
  
  return (key: string, callback: () => void) => {
    if (pending.has(key)) {
      clearTimeout(pending.get(key));
    }
    pending.set(key, setTimeout(() => {
      callback();
      pending.delete(key);
    }, delay));
  };
};

/**
 * Global real-time sync hook that subscribes to database changes
 * and invalidates React Query cache automatically.
 * 
 * Optimized for 2M registrations and 300 concurrent users:
 * - Debounced invalidations to prevent query storms
 * - Batched updates for multiple rapid changes
 * - Selective table subscriptions
 */
export const useRealtimeSync = (options: RealtimeSyncOptions = {}) => {
  const {
    tables = ['student_registrations', 'student_subjects', 'students', 'schools', 'school_project_workflow', 'payment_transactions'],
    projectId,
    debounceMs = 1000, // 1 second debounce for high concurrency
  } = options;
  
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef(createDebouncer(debounceMs));
  
  // Map of table -> query keys to invalidate
  const tableQueryMap: Record<TableName, string[]> = {
    student_registrations: [
      'student-registrations',
      'student-registrations-all-v3',
      'all-olympiad-registrations',
      'school-students',
      'dashboard-metrics',
      'registration-summary',
    ],
    student_subjects: [
      'student-registrations',
      'student-registrations-all-v3',
      'all-olympiad-registrations',
      'school-students',
      'registration-summary',
    ],
    students: [
      'school-students',
      'student-registrations',
      'student-registrations-all-v3',
      'all-olympiad-registrations',
      'registration-summary',
    ],
    schools: [
      'schools-paginated',
      'school-filter-options',
      'dashboard-metrics',
      'registration-summary',
    ],
    school_project_workflow: [
      'school-workflow',
      'project-workflows',
      'schools-paginated',
      'dashboard-metrics',
      'accountant-dashboard',
    ],
    payment_transactions: [
      'payment-transactions',
      'accountant-dashboard',
      'dashboard-metrics',
    ],
    communications: [
      'communications',
    ],
    follow_ups: [
      'follow-ups',
    ],
    portal_registered_students: [
      'crm-portal-students',
      'dashboard-reg-summary',
      'portal-enrollment-count',
      'crm-reg-summary',
    ],
    portal_student_enrollments: [
      'crm-portal-students',
      'dashboard-reg-summary',
      'portal-enrollment-count',
      'crm-reg-summary',
      'portal-participations',
    ],
  };
  
  const invalidateQueriesForTable = useCallback((tableName: TableName) => {
    const queryKeys = tableQueryMap[tableName] || [];
    
    // Use debounced invalidation to prevent query storms
    debounceRef.current(`invalidate-${tableName}`, () => {
      console.log(`🔄 Real-time: Invalidating queries for ${tableName}`);
      
      queryKeys.forEach(key => {
        queryClient.invalidateQueries({ 
          queryKey: [key],
          refetchType: 'active', // Only refetch active queries
        });
      });
    });
  }, [queryClient]);
  
  useEffect(() => {
    // Create a single channel for all table subscriptions
    const channelName = projectId ? `realtime-sync-${projectId}` : 'realtime-sync-global';
    
    console.log(`📡 Initializing real-time sync for tables: ${tables.join(', ')}`);
    
    const channel = supabase.channel(channelName);
    
    // Subscribe to each table
    tables.forEach(tableName => {
      channel.on(
        'postgres_changes',
        {
          event: '*', // All events: INSERT, UPDATE, DELETE
          schema: 'public',
          table: tableName,
        },
        (payload) => {
          console.log(`📥 Real-time event on ${tableName}:`, payload.eventType);
          invalidateQueriesForTable(tableName);
        }
      );
    });
    
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Real-time sync connected');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Real-time sync error');
      }
    });
    
    channelRef.current = channel;
    
    return () => {
      console.log('🔌 Disconnecting real-time sync');
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [tables.join(','), projectId, invalidateQueriesForTable]);
  
  // Manual refresh function for explicit data sync
  const forceRefresh = useCallback((tableName?: TableName) => {
    if (tableName) {
      const queryKeys = tableQueryMap[tableName] || [];
      queryKeys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });
    } else {
      // Refresh all tracked tables
      tables.forEach(table => {
        tableQueryMap[table]?.forEach(key => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      });
    }
  }, [queryClient, tables]);
  
  return { forceRefresh };
};

/**
 * Lightweight hook for components that only need to trigger refresh
 */
export const useRefreshData = () => {
  const queryClient = useQueryClient();
  
  const refreshStudentRegistrations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
    queryClient.invalidateQueries({ queryKey: ['student-registrations-all-v3'] });
    queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
    queryClient.invalidateQueries({ queryKey: ['school-students'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
  }, [queryClient]);
  
  const refreshSchools = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['schools-paginated'] });
    queryClient.invalidateQueries({ queryKey: ['school-filter-options'] });
  }, [queryClient]);
  
  const refreshPayments = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['payment-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['accountant-dashboard'] });
  }, [queryClient]);
  
  const refreshAll = useCallback(() => {
    refreshStudentRegistrations();
    refreshSchools();
    refreshPayments();
  }, [refreshStudentRegistrations, refreshSchools, refreshPayments]);
  
  return {
    refreshStudentRegistrations,
    refreshSchools,
    refreshPayments,
    refreshAll,
  };
};
