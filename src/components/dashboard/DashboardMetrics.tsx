import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { useNavigate } from 'react-router-dom';
import { 
  School, 
  Phone, 
  CheckCircle, 
  XCircle, 
  FileText, 
  DollarSign,
  Send,
  Users,
  Calendar,
  RotateCcw
} from 'lucide-react';
import { DashboardMetrics as MetricsType, DashboardMetricsByDate as DateMetricsType } from '@/types/database';
import { format } from 'date-fns';
import { useActiveProject, useOlympiadProjects } from '@/hooks/useOlympiadProjects';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ProjectMetrics extends MetricsType {
  total_registrations: number;
  total_students?: number;
}

export const DashboardMetrics: React.FC = () => {
  const { getDashboardMetricsByProject, getDashboardMetricsByDate } = useSchoolsPaginated();
  const { data: activeProject } = useActiveProject();
  const { data: allProjects } = useOlympiadProjects();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [dateMetrics, setDateMetrics] = useState<DateMetricsType | null>(null);
  const [comparisonProject, setComparisonProject] = useState<string>('');
  const [comparisonMetrics, setComparisonMetrics] = useState<ProjectMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDateView, setShowDateView] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  const fetchOverallMetrics = async () => {
    try {
      setLoading(true);
      const data = await getDashboardMetricsByProject(activeProject?.id);
      let totalStudents = 0;
      if (activeProject?.id) {
        const { data: ts } = await supabase.rpc('get_total_students_count', { p_project_id: activeProject.id });
        totalStudents = (ts as number) || 0;
      }
      setMetrics({ ...(data as ProjectMetrics), total_students: totalStudents });
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      toast.error('Failed to load dashboard metrics. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchComparisonMetrics = async (projectId: string) => {
    try {
      const data = await getDashboardMetricsByProject(projectId);
      const { data: ts } = await supabase.rpc('get_total_students_count', { p_project_id: projectId });
      setComparisonMetrics({ ...(data as ProjectMetrics), total_students: (ts as number) || 0 });
    } catch (error) {
      console.error('Failed to fetch comparison metrics:', error);
      toast.error('Failed to load comparison metrics.');
    }
  };

  const fetchDateMetrics = async (date: string) => {
    try {
      setLoading(true);
      const data = await getDashboardMetricsByDate(date);
      setDateMetrics(data);
    } catch (error) {
      console.error('Failed to fetch date metrics:', error);
      toast.error('Failed to load date-filtered metrics.');
    } finally {
      setLoading(false);
    }
  };

  const handleDateSubmit = () => {
    if (selectedDate) {
      setShowDateView(true);
      fetchDateMetrics(selectedDate);
    }
  };

  const handleShowOverall = () => {
    setShowDateView(false);
    setDateMetrics(null);
    fetchOverallMetrics();
  };

  useEffect(() => {
    if (activeProject?.id) {
      fetchOverallMetrics();
      const today = new Date().toISOString().split('T')[0];
      setSelectedDate(today);
      setShowDateView(true);
      fetchDateMetrics(today);
    }
  }, [activeProject?.id]);

  const handleComparisonChange = (projectId: string) => {
    setComparisonProject(projectId);
    if (projectId && projectId !== 'none') {
      setShowComparison(true);
      fetchComparisonMetrics(projectId);
    } else {
      setShowComparison(false);
      setComparisonMetrics(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 12 }).map((_, index) => (
          <Card key={index} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!metrics && !dateMetrics) {
    return <div>Failed to load metrics</div>;
  }

  const currentMetrics = showDateView ? dateMetrics : metrics;
  const isDateView = showDateView && dateMetrics;

  // Function to handle metric card clicks and navigate to schools with filters
  const handleMetricClick = (filterType: string) => {
    const params = new URLSearchParams();
    
    // Use the current date view if active, otherwise use today's date
    const targetDate = showDateView && selectedDate ? selectedDate : new Date().toISOString().split('T')[0];
    params.set('date', targetDate);
    
    switch (filterType) {
      case 'total':
        // No additional filters for total schools
        break;
      case 'courier_sent':
        params.set('courier_status', 'Sent');
        break;
      case 'contacted_yes':
        params.set('contacted', 'Yes');
        break;
      case 'registration_interested':
        params.set('registration_interest', 'Interested');
        break;
      case 'registration_not_interested':
        params.set('registration_interest', 'Not Interested');
        break;
      case 'consent_requested':
        params.set('consent_form_requested', 'Yes');
        break;
      case 'consent_form_sent_total':
        params.set('consent_form_sent', 'Sent,Sent Digitally');
        break;
      case 'consent_form_sent_physical':
        params.set('consent_form_sent', 'Sent');
        break;
      case 'consent_form_sent_digital':
        params.set('consent_form_sent', 'Sent Digitally');
        break;
      case 'registration_confirmed':
        params.set('registration_status', 'Confirmed');
        break;
      case 'registration_in_progress':
        params.set('registration_status', 'In Progress');
        break;
      case 'name_list_received':
        params.set('name_list_status', 'Received');
        break;
      case 'name_list_uploaded':
        params.set('name_list_status', 'Uploaded');
        break;
      case 'payment_received':
        params.set('payment_status', 'Received');
        break;
      case 'question_paper_sent':
        params.set('question_paper_sent', 'Sent');
        break;
      case 'answer_sheet_received':
        params.set('answer_sheet_status', 'Received');
        break;
      case 'result_sent':
        params.set('result_status', 'Sent');
        break;
      case 'total_registrations':
        navigate('/olympiad-management');
        return; // Don't add URL params for this case
      default:
        break;
    }
    
    navigate(`/schools?${params.toString()}`);
  };

  // Organize metrics according to user's requested layout
  const getMetricRows = () => {
    if (!currentMetrics) return { row1: [], row2: [], row3: [], row4: [], row5: [], dateSpecificMetrics: [] };

    // Row 1: Total Schools, Contacted, Registration Interested, Not Interested  
    const row1 = [
      {
        title: 'Total Schools',
        value: currentMetrics.total_schools,
        icon: School,
        color: 'text-blue-600',
        filterType: 'total'
      },
      {
        title: 'Schools Contacted',
        value: currentMetrics.contacted_yes,
        icon: Phone,
        color: 'text-purple-600',
        filterType: 'contacted_yes'
      },
      {
        title: 'Registration Interested',
        value: currentMetrics.registration_interested,
        icon: CheckCircle,
        color: 'text-emerald-600',
        filterType: 'registration_interested'
      },
      {
        title: 'Not Interested',
        value: currentMetrics.registration_not_interested,
        icon: XCircle,
        color: 'text-red-600',
        filterType: 'registration_not_interested'
      }
    ];

    // Row 2: Consent form requested - consent form sent total - Physical - digital
    const row2 = [
      {
        title: 'Consent Forms Requested',
        value: currentMetrics.consent_requested,
        icon: FileText,
        color: 'text-orange-600',
        filterType: 'consent_requested'
      },
      {
        title: 'Consent Forms Sent (Total)',
        value: currentMetrics.consent_form_sent_total,
        icon: Send,
        color: 'text-blue-500',
        filterType: 'consent_form_sent_total'
      },
      {
        title: 'Consent Forms (Physical)',
        value: currentMetrics.consent_form_sent_physical,
        icon: FileText,
        color: 'text-indigo-500',
        filterType: 'consent_form_sent_physical'
      },
      {
        title: 'Consent Forms (Digital)',
        value: currentMetrics.consent_form_sent_digital,
        icon: Send,
        color: 'text-cyan-500',
        filterType: 'consent_form_sent_digital'
      }
    ];

    // Row 3: Registration confirmed - payment received - namelist received
    const row3 = [
      {
        title: 'Registration Confirmed',
        value: currentMetrics.registration_confirmed,
        icon: CheckCircle,
        color: 'text-green-600',
        filterType: 'registration_confirmed'
      },
      {
        title: 'Payment Received',
        value: currentMetrics.payment_received,
        icon: DollarSign,
        color: 'text-yellow-600',
        filterType: 'payment_received'
      },
      {
        title: 'Name Lists Received',
        value: currentMetrics.name_list_received,
        icon: Users,
        color: 'text-indigo-600',
        filterType: 'name_list_received'
      },
      {
        title: 'Name Lists Uploaded',
        value: currentMetrics.name_list_uploaded,
        icon: CheckCircle,
        color: 'text-green-600',
        filterType: 'name_list_uploaded'
      }
    ];

    // Row 4: question paper sent - answer sheet received - result sent
    const row4 = [
      {
        title: 'Question Papers Sent',
        value: currentMetrics.question_paper_sent,
        icon: Send,
        color: 'text-teal-600',
        filterType: 'question_paper_sent'
      },
      {
        title: 'Answer Sheets Received',
        value: currentMetrics.answer_sheet_received,
        icon: FileText,
        color: 'text-pink-600',
        filterType: 'answer_sheet_received'
      },
      {
        title: 'Results Sent',
        value: currentMetrics.result_sent,
        icon: CheckCircle,
        color: 'text-cyan-600',
        filterType: 'result_sent'
      }
    ];

    // Row 5: project-level totals — always from overall metrics regardless of date view
    const row5 = [
      {
        title: 'Total Schools',
        value: metrics?.total_schools ?? currentMetrics.total_schools,
        icon: School,
        color: 'text-blue-600',
        filterType: 'total'
      },
      {
        title: 'Total Students',
        value: metrics?.total_students ?? 0,
        icon: Users,
        color: 'text-indigo-600',
        filterType: 'total_students'
      },
      {
        title: 'Total Participations',
        value: metrics?.total_registrations || 0,
        icon: Users,
        color: 'text-emerald-600',
        filterType: 'total_registrations'
      }
    ];

    // Add date-specific metrics if in date view
    const dateSpecificMetrics = isDateView ? [
      {
        title: 'Communications (Day)',
        value: (currentMetrics as DateMetricsType).communications_count,
        icon: Phone,
        color: 'text-violet-600',
        filterType: 'communications'
      },
      {
        title: 'Follow-ups Created',
        value: (currentMetrics as DateMetricsType).follow_ups_created,
        icon: Calendar,
        color: 'text-amber-600',
        filterType: 'follow_ups_created'
      },
      {
        title: 'Follow-ups Completed',
        value: (currentMetrics as DateMetricsType).follow_ups_completed,
        icon: CheckCircle,
        color: 'text-lime-600',
        filterType: 'follow_ups_completed'
      }
    ] : [];

    return {
      row1,
      row2, 
      row3,
      row4,
      row5,
      dateSpecificMetrics
    };
  };

  const metricRows = getMetricRows();

  const renderMetricCard = (metric: any, index: number, keyPrefix: string) => {
    // Define gradient colors based on section
    const getGradientClass = () => {
      if (keyPrefix === 'row1') {
        // School Contact & Interest - soft blues and purples
        const gradients = [
          'bg-gradient-to-br from-blue-50 via-blue-50 to-blue-100 dark:from-blue-950/30 dark:via-blue-900/20 dark:to-blue-800/30 border-blue-200/50 dark:border-blue-800/30',
          'bg-gradient-to-br from-purple-50 via-purple-50 to-purple-100 dark:from-purple-950/30 dark:via-purple-900/20 dark:to-purple-800/30 border-purple-200/50 dark:border-purple-800/30',
          'bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:via-emerald-900/20 dark:to-emerald-800/30 border-emerald-200/50 dark:border-emerald-800/30',
          'bg-gradient-to-br from-rose-50 via-rose-50 to-rose-100 dark:from-rose-950/30 dark:via-rose-900/20 dark:to-rose-800/30 border-rose-200/50 dark:border-rose-800/30'
        ];
        return gradients[index % gradients.length];
      } else if (keyPrefix === 'row2') {
        // Consent Forms - soft oranges and cyans
        const gradients = [
          'bg-gradient-to-br from-orange-50 via-orange-50 to-orange-100 dark:from-orange-950/30 dark:via-orange-900/20 dark:to-orange-800/30 border-orange-200/50 dark:border-orange-800/30',
          'bg-gradient-to-br from-sky-50 via-sky-50 to-sky-100 dark:from-sky-950/30 dark:via-sky-900/20 dark:to-sky-800/30 border-sky-200/50 dark:border-sky-800/30',
          'bg-gradient-to-br from-indigo-50 via-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:via-indigo-900/20 dark:to-indigo-800/30 border-indigo-200/50 dark:border-indigo-800/30',
          'bg-gradient-to-br from-cyan-50 via-cyan-50 to-cyan-100 dark:from-cyan-950/30 dark:via-cyan-900/20 dark:to-cyan-800/30 border-cyan-200/50 dark:border-cyan-800/30'
        ];
        return gradients[index % gradients.length];
      } else if (keyPrefix === 'row3') {
        // Registration & Payment - soft greens and yellows
        const gradients = [
          'bg-gradient-to-br from-green-50 via-green-50 to-green-100 dark:from-green-950/30 dark:via-green-900/20 dark:to-green-800/30 border-green-200/50 dark:border-green-800/30',
          'bg-gradient-to-br from-amber-50 via-amber-50 to-amber-100 dark:from-amber-950/30 dark:via-amber-900/20 dark:to-amber-800/30 border-amber-200/50 dark:border-amber-800/30',
          'bg-gradient-to-br from-indigo-50 via-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:via-indigo-900/20 dark:to-indigo-800/30 border-indigo-200/50 dark:border-indigo-800/30',
          'bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:via-emerald-900/20 dark:to-emerald-800/30 border-emerald-200/50 dark:border-emerald-800/30'
        ];
        return gradients[index % gradients.length];
      } else if (keyPrefix === 'row4') {
        // Question Papers & Results - soft teals and pinks
        const gradients = [
          'bg-gradient-to-br from-teal-50 via-teal-50 to-teal-100 dark:from-teal-950/30 dark:via-teal-900/20 dark:to-teal-800/30 border-teal-200/50 dark:border-teal-800/30',
          'bg-gradient-to-br from-pink-50 via-pink-50 to-pink-100 dark:from-pink-950/30 dark:via-pink-900/20 dark:to-pink-800/30 border-pink-200/50 dark:border-pink-800/30',
          'bg-gradient-to-br from-cyan-50 via-cyan-50 to-cyan-100 dark:from-cyan-950/30 dark:via-cyan-900/20 dark:to-cyan-800/30 border-cyan-200/50 dark:border-cyan-800/30'
        ];
        return gradients[index % gradients.length];
      } else if (keyPrefix === 'row5') {
        // Overview - soft slate and blue
        const gradients = [
          'bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 dark:from-slate-950/30 dark:via-slate-900/20 dark:to-slate-800/30 border-slate-200/50 dark:border-slate-800/30',
          'bg-gradient-to-br from-blue-50 via-blue-50 to-blue-100 dark:from-blue-950/30 dark:via-blue-900/20 dark:to-blue-800/30 border-blue-200/50 dark:border-blue-800/30'
        ];
        return gradients[index % gradients.length];
      } else {
        // Date metrics - soft violet and lime
        const gradients = [
          'bg-gradient-to-br from-violet-50 via-violet-50 to-violet-100 dark:from-violet-950/30 dark:via-violet-900/20 dark:to-violet-800/30 border-violet-200/50 dark:border-violet-800/30',
          'bg-gradient-to-br from-lime-50 via-lime-50 to-lime-100 dark:from-lime-950/30 dark:via-lime-900/20 dark:to-lime-800/30 border-lime-200/50 dark:border-lime-800/30'
        ];
        return gradients[index % gradients.length];
      }
    };

    return (
      <Card 
        key={`${keyPrefix}-${index}`} 
        className={`hover:shadow-xl transition-all duration-300 cursor-pointer hover:scale-105 ${getGradientClass()}`}
        onClick={() => handleMetricClick(metric.filterType)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {metric.title}
          </CardTitle>
          <metric.icon className={`h-5 w-5 ${metric.color}`} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metric.value}</div>
          {showComparison && comparisonMetrics && (
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-xs">
                vs {allProjects?.find(p => p.id === comparisonProject)?.project_year}: {
                  (() => {
                    const compValue = (comparisonMetrics as any)[metric.filterType];
                    return typeof compValue === 'number' ? compValue : 0;
                  })()
                }
              </Badge>
              <span className={`text-xs font-medium ${
                (() => {
                  const compValue = typeof (comparisonMetrics as any)[metric.filterType] === 'number' 
                    ? (comparisonMetrics as any)[metric.filterType] : 0;
                  return metric.value > compValue ? 'text-green-600' : 
                         metric.value < compValue ? 'text-red-600' : 'text-gray-600';
                })()
              }`}>
                {(() => {
                  const compValue = typeof (comparisonMetrics as any)[metric.filterType] === 'number' 
                    ? (comparisonMetrics as any)[metric.filterType] : 0;
                  return metric.value > compValue ? '↗' : metric.value < compValue ? '↘' : '→';
                })()}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1">Click to view schools</p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Date Filter Controls */}
      <Card className="bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 border-slate-200 dark:border-slate-700 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Dashboard View
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="date">Select Date to View Daily Progress</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
            <Button onClick={handleDateSubmit} disabled={!selectedDate}>
              View Date Progress
            </Button>
            <Button variant="outline" onClick={handleShowOverall}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Show Overall
            </Button>
          </div>
          
          {/* Year Comparison Controls */}
          {!showDateView && allProjects && allProjects.length > 1 && (
            <div className="mt-6 pt-4 border-t">
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label htmlFor="comparison">Compare with Previous Year</Label>
                  <Select value={comparisonProject} onValueChange={handleComparisonChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select project to compare" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No comparison</SelectItem>
                      {allProjects
                        .filter(p => p.id !== activeProject?.id)
                        .map(project => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.project_name} ({project.project_year})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          
          {showDateView && selectedDate && (
            <div className="mt-3 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Viewing work done on:</strong> {format(new Date(selectedDate), 'MMMM dd, yyyy')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics Grid - Organized in Rows */}
      <div className="space-y-8">
        {/* Row 1: Total Schools, Contacted, Registration Interest */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-muted-foreground">School Contact & Interest</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {metricRows.row1.map((metric, index) => renderMetricCard(metric, index, 'row1'))}
          </div>
        </div>

        {/* Row 2: Consent Forms */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Consent Forms</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {metricRows.row2.map((metric, index) => renderMetricCard(metric, index, 'row2'))}
          </div>
        </div>

        {/* Row 3: Registration & Payment */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Registration & Payment</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {metricRows.row3.map((metric, index) => renderMetricCard(metric, index, 'row3'))}
          </div>
        </div>

        {/* Row 4: Question Papers & Results */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Question Papers & Results</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {metricRows.row4.map((metric, index) => renderMetricCard(metric, index, 'row4'))}
          </div>
        </div>

        {/* Row 5: Overview */}
        <div>
          <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {metricRows.row5.map((metric, index) => renderMetricCard(metric, index, 'row5'))}
          </div>
        </div>

        {/* Date-specific metrics if in date view */}
        {isDateView && metricRows.dateSpecificMetrics.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-4 text-muted-foreground">Daily Activity</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {metricRows.dateSpecificMetrics.map((metric, index) => renderMetricCard(metric, index, 'date'))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};