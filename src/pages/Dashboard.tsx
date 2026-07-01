import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Navbar from '@/components/layout/Navbar';
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics';
import { ConsentFormsTable } from '@/components/dashboard/ConsentFormsTable';
import { RegistrationSummary } from '@/components/dashboard/RegistrationSummary';
import { MessageSquare, Users, TrendingUp, Clock, RefreshCw, Phone, Mail, Bot } from 'lucide-react';
import ProjectSelector from '@/components/olympiad/ProjectSelector';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useState, useEffect, useMemo } from 'react';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { useRefreshData } from '@/hooks/useRealtimeSync';
import { supabase } from '@/integrations/supabase/client';


const Dashboard = () => {
  const { profile } = useAuth();
  const { schools, loading } = useSchoolsPaginated();
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();
  const { data: dashboardMetrics } = useDashboardMetrics(activeProject?.id);
  const { refreshAll } = useRefreshData();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Memoize metrics to prevent unnecessary re-renders
  const { registrationInProgress, totalRegistrations } = useMemo(() => ({
    registrationInProgress: dashboardMetrics?.registration_in_progress || 0,
    totalRegistrations: dashboardMetrics?.total_registrations || 0,
  }), [dashboardMetrics]);

  // Recent communications — real activity feed
  const [recentComms, setRecentComms] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('communications')
      .select('id, communication_type, details, created_at, schools(school_name, ss_no)')
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => setRecentComms(data || []));
  }, []);

  const COMM_ICON: Record<string, React.ElementType> = {
    Phone: Phone, Email: Mail, WhatsApp: MessageSquare, 'AI Call': Bot,
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    refreshAll();
    // Small delay for visual feedback
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Redirect accountants to their specific dashboard
  if (profile?.role === 'accountant') {
    return <Navigate to="/accountant" replace />;
  }

  // Redirect accountants to their specific dashboard
  if ((profile?.role as string) === 'accountant') {
    return <Navigate to="/accountant" replace />;
  }


  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section with Project Selector */}
        <Card className="mb-8 bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-lg">
          <CardContent className="pt-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
                <p className="text-muted-foreground">
                  Project-specific metrics and workflow overview
                </p>
                {activeProject && (
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="font-medium">Current Project:</span>
                    <span className="text-primary">{activeProject.project_name}</span>
                    <span className="text-muted-foreground">({activeProject.project_year})</span>
                  </div>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="w-[320px]">
                  <ProjectSelector />
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={handleRefresh} 
                    variant="outline" 
                    size="sm"
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
                  </Button>
                  <Button onClick={() => navigate('/communication')}>
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Log Communication
                  </Button>
                </div>
              </div>
            </div>
            
            {/* Project Summary Stats */}
            {activeProject && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-blue-400/20">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                  <div className="relative flex items-center gap-3">
                    <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                      <Users className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-blue-100 font-medium">Total Registrations</p>
                      <p className="text-3xl font-bold text-white">
                        {totalRegistrations.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-teal-600 dark:from-emerald-600 dark:to-teal-700 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-emerald-400/20">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                  <div className="relative flex items-center gap-3">
                    <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                      <TrendingUp className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-emerald-100 font-medium">Project Year</p>
                      <p className="text-3xl font-bold text-white">
                        {activeProject.project_year}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 dark:from-amber-600 dark:to-orange-700 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer border border-amber-400/20"
                     onClick={() => navigate('/schools?registration_status=In+Progress')}>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                  <div className="relative flex items-center gap-3">
                    <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                      <Clock className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-amber-100 font-medium">In Progress</p>
                      <p className="text-3xl font-bold text-white">
                        {registrationInProgress}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="relative overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 dark:from-violet-600 dark:to-purple-700 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-violet-400/20">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
                  <div className="relative flex items-center gap-3">
                    <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                      <MessageSquare className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm text-violet-100 font-medium">Project Status</p>
                      <p className="text-2xl font-bold text-white">
                        {activeProject.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>


        <DashboardMetrics />

        <div className="mt-8">
          <RegistrationSummary />
          <ConsentFormsTable />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Communications */}
            <Card className="border-slate-200 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Recent Communications</CardTitle>
              </CardHeader>
              <CardContent>
                {recentComms.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No communications logged yet</p>
                ) : (
                  <div className="space-y-3">
                    {recentComms.map((c) => {
                      const Icon = COMM_ICON[c.communication_type] || MessageSquare;
                      const school = c.schools as { school_name: string; ss_no: number } | null;
                      const minsAgo = Math.round((Date.now() - new Date(c.created_at).getTime()) / 60000);
                      const timeLabel = minsAgo < 60
                        ? `${minsAgo}m ago`
                        : minsAgo < 1440
                        ? `${Math.round(minsAgo / 60)}h ago`
                        : `${Math.round(minsAgo / 1440)}d ago`;
                      return (
                        <div key={c.id} className="flex items-start gap-3">
                          <div className={`mt-0.5 p-1.5 rounded-lg flex-shrink-0 ${
                            c.communication_type === 'AI Call'  ? 'bg-purple-50' :
                            c.communication_type === 'Phone'    ? 'bg-blue-50' :
                            c.communication_type === 'WhatsApp' ? 'bg-green-50' : 'bg-orange-50'
                          }`}>
                            <Icon className={`h-3.5 w-3.5 ${
                              c.communication_type === 'AI Call'  ? 'text-purple-600' :
                              c.communication_type === 'Phone'    ? 'text-blue-600' :
                              c.communication_type === 'WhatsApp' ? 'text-green-600' : 'text-orange-600'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {school?.school_name ?? 'Unknown School'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.communication_type} · {c.details?.substring(0, 50) || 'No details'}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{timeLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button variant="ghost" size="sm" className="w-full mt-3 text-xs" onClick={() => navigate('/communication')}>
                  View all communications →
                </Button>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="border-slate-200 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { label: 'Add / Search School',       path: '/schools',             color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
                    { label: 'Log Communication',         path: '/communication',       color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                    { label: 'View Follow-ups',           path: '/follow-ups',          color: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
                    { label: 'Portal Approvals',          path: '/portal-access',       color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                    { label: 'Payment Queue',             path: '/payment-queue',       color: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
                    { label: 'Olympiad Management',       path: '/olympiad-management', color: 'bg-rose-50 text-rose-700 hover:bg-rose-100' },
                  ].map(({ label, path, color }) => (
                    <Button key={path} variant="ghost"
                      className={`w-full justify-start font-medium ${color}`}
                      onClick={() => navigate(path)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;