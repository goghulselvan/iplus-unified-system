import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CalendarIcon, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportToCSV, exportToPDF } from '@/utils/auditLogExport';

export const AuditLogExporter = () => {
  const { profile } = useAuth();
  const [startDate, setStartDate] = useState<Date>(new Date('2025-10-25'));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{
    payments: number;
    newRegistrations: number;
    updatedRegistrations: number;
    activityLogs: number;
  } | null>(null);
  const [auditData, setAuditData] = useState<any>(null);

  // Quick date range buttons
  const setQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setStartDate(start);
    setEndDate(end);
  };

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      // Fetch Payment Transactions
      const { data: payments, error: paymentsError } = await supabase
        .from('payment_transactions')
        .select(`
          *,
          schools!inner(school_name, ss_no)
        `)
        .gte('created_at', startDateStr)
        .lte('created_at', endDateStr + 'T23:59:59')
        .order('created_at', { ascending: false });

      if (paymentsError) throw paymentsError;

      // Fetch New Student Registrations (created in date range)
      const { data: newRegistrations, error: newRegError } = await supabase
        .from('student_registrations')
        .select(`
          *,
          schools!inner(school_name, ss_no)
        `)
        .gte('created_at', startDateStr)
        .lte('created_at', endDateStr + 'T23:59:59')
        .order('created_at', { ascending: false });

      if (newRegError) throw newRegError;

      // Fetch Updated Student Registrations (updated after creation)
      const { data: updatedRegistrations, error: updateRegError } = await supabase
        .from('student_registrations')
        .select(`
          *,
          schools!inner(school_name, ss_no)
        `)
        .gte('updated_at', startDateStr)
        .lte('updated_at', endDateStr + 'T23:59:59')
        .order('updated_at', { ascending: false });

      if (updateRegError) throw updateRegError;

      // Filter out registrations where updated_at equals created_at
      const actuallyUpdated = updatedRegistrations?.filter(r => r.updated_at !== r.created_at) || [];

      // Fetch Activity Logs
      const { data: activityLogs, error: activityError } = await supabase
        .from('activity_logs')
        .select(`
          *,
          schools!inner(school_name, ss_no)
        `)
        .gte('created_at', startDateStr)
        .lte('created_at', endDateStr + 'T23:59:59')
        .order('created_at', { ascending: false });

      if (activityError) throw activityError;

      // Transform data for export
      const transformedPayments = payments?.map(p => ({
        school_name: p.schools.school_name,
        ss_no: p.schools.ss_no,
        payment_amount: p.payment_amount,
        payment_date: p.payment_date,
        payment_mode: p.payment_mode,
        notes: p.notes,
        transaction_reference: p.transaction_reference,
        added_by: 'N/A',
        created_at: p.created_at
      })) || [];

      const transformedNewReg = newRegistrations?.map(r => ({
        school_name: r.schools.school_name,
        ss_no: r.schools.ss_no,
        student_name: r.student_name,
        student_class: r.student_class,
        registration_number_generated: r.registration_number_generated,
        roll_number: r.roll_number,
        added_by: 'N/A',
        created_at: r.created_at
      })) || [];

      const transformedUpdatedReg = actuallyUpdated?.map(r => ({
        school_name: r.schools.school_name,
        ss_no: r.schools.ss_no,
        student_name: r.student_name,
        student_class: r.student_class,
        registration_number_generated: r.registration_number_generated,
        roll_number: r.roll_number,
        added_by: 'N/A',
        created_at: r.updated_at
      })) || [];

      const transformedActivity = activityLogs?.map(l => ({
        school_name: l.schools.school_name,
        ss_no: l.schools.ss_no,
        activity_type: l.activity_type,
        field_name: l.field_name,
        old_value: l.old_value,
        new_value: l.new_value,
        changed_by: 'N/A',
        created_at: l.created_at
      })) || [];

      const data = {
        payments: transformedPayments,
        newRegistrations: transformedNewReg,
        updatedRegistrations: transformedUpdatedReg,
        activityLogs: transformedActivity,
        startDate: startDateStr,
        endDate: endDateStr
      };

      setAuditData(data);
      setSummary({
        payments: transformedPayments.length,
        newRegistrations: transformedNewReg.length,
        updatedRegistrations: transformedUpdatedReg.length,
        activityLogs: transformedActivity.length
      });

      toast.success('Audit data loaded successfully');
    } catch (error: any) {
      console.error('Error fetching audit data:', error);
      toast.error(error.message || 'Failed to fetch audit data');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!auditData) {
      toast.error('Please fetch data first');
      return;
    }
    try {
      exportToCSV(auditData);
      toast.success('CSV exported successfully');
    } catch (error: any) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const handleExportPDF = () => {
    if (!auditData) {
      toast.error('Please fetch data first');
      return;
    }
    try {
      exportToPDF(auditData);
      toast.success('PDF exported successfully');
    } catch (error: any) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export PDF');
    }
  };

  // Restrict to superadmins only
  if (profile?.role !== 'superadmin') {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Access denied. Only superadmins can export audit logs.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Range Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Date Range Selection</CardTitle>
          <CardDescription>Select the date range for audit log export</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Start Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setQuickRange(7)}>
              Last 7 Days
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuickRange(30)}>
              Last 30 Days
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuickRange(90)}>
              Last 3 Months
            </Button>
          </div>

          <Button onClick={fetchAuditData} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Fetching Data...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Fetch Audit Data
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Data Summary */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Data Summary</CardTitle>
            <CardDescription>
              Summary of audit data from {format(startDate, 'PPP')} to {format(endDate, 'PPP')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-2xl font-bold text-foreground">{summary.payments}</div>
                <div className="text-sm text-muted-foreground">Payment Transactions</div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-2xl font-bold text-foreground">{summary.newRegistrations}</div>
                <div className="text-sm text-muted-foreground">New Registrations</div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-2xl font-bold text-foreground">{summary.updatedRegistrations}</div>
                <div className="text-sm text-muted-foreground">Updated Registrations</div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-2xl font-bold text-foreground">{summary.activityLogs}</div>
                <div className="text-sm text-muted-foreground">Activity Log Entries</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export Options */}
      {auditData && (
        <Card>
          <CardHeader>
            <CardTitle>Export Options</CardTitle>
            <CardDescription>Download audit logs in your preferred format</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button onClick={handleExportPDF} className="flex-1 min-w-[200px]">
              <FileText className="mr-2 h-4 w-4" />
              Export as PDF
            </Button>
            <Button onClick={handleExportCSV} variant="outline" className="flex-1 min-w-[200px]">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export as Excel (CSV)
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
