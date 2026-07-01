import { QueryClient } from '@tanstack/react-query';

/**
 * Optimized QueryClient configuration for 2M registrations and 300 concurrent users
 * 
 * Key optimizations:
 * - Extended cache times to reduce database load
 * - Reduced refetching to prevent query storms
 * - Optimized garbage collection
 * - Smart retry logic
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Extended stale time for high-scale scenarios
      staleTime: 5 * 60 * 1000, // 5 minutes default
      
      // Extended garbage collection time
      gcTime: 30 * 60 * 1000, // 30 minutes
      
      // Disable aggressive refetching for 300 concurrent users
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: 'always',
      
      // Smart retry with exponential backoff
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors (client errors)
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        // Retry up to 2 times for server errors
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      // Network mode for offline support
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
      retryDelay: 1000,
      
      // Network mode
      networkMode: 'offlineFirst',
    },
  },
});

/**
 * Query key factory for consistent key generation
 */
export const queryKeys = {
  // Student registrations
  studentRegistrations: {
    all: ['student-registrations'] as const,
    allV3: ['student-registrations-all-v3'] as const,
    olympiad: (projectId?: string) => ['all-olympiad-registrations', projectId] as const,
    filtered: (projectId: string, filters: Record<string, any>) => 
      ['student-registrations', projectId, filters] as const,
  },
  
  // Schools
  schools: {
    all: ['schools'] as const,
    paginated: (page: number, filters: Record<string, any>) => 
      ['schools-paginated', page, filters] as const,
    detail: (id: string) => ['school', id] as const,
    filterOptions: ['school-filter-options'] as const,
  },
  
  // Dashboard
  dashboard: {
    metrics: (projectId?: string) => ['dashboard-metrics', projectId] as const,
    accountant: ['accountant-dashboard'] as const,
  },
  
  // Payments
  payments: {
    all: ['payment-transactions'] as const,
    bySchool: (schoolId: string) => ['payment-transactions', schoolId] as const,
  },
  
  // Projects
  projects: {
    all: ['olympiad-projects'] as const,
    active: ['active-project'] as const,
    subjects: (projectId?: string) => ['olympiad-subjects', projectId] as const,
  },
  
  // Communications
  communications: {
    bySchool: (schoolId: string) => ['communications', schoolId] as const,
  },
  
  // Follow-ups
  followUps: {
    all: ['follow-ups'] as const,
  },
};

/**
 * Prefetch commonly used data for faster navigation
 */
export const prefetchDashboardData = async (projectId?: string) => {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboard.metrics(projectId),
      staleTime: 10 * 60 * 1000,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.schools.filterOptions,
      staleTime: 30 * 60 * 1000,
    }),
  ]);
};

/**
 * Clear all cached data (for logout, project switch, etc.)
 */
export const clearAllCache = () => {
  queryClient.clear();
};

/**
 * Invalidate project-specific data
 */
export const invalidateProjectData = (projectId?: string) => {
  queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
  queryClient.invalidateQueries({ queryKey: ['all-olympiad-registrations'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
  if (projectId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.studentRegistrations.olympiad(projectId) });
  }
};
