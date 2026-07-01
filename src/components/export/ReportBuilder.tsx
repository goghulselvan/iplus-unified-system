import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Download, Loader2, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import FilterSection from './FilterSection';
import ColumnSelector from './ColumnSelector';
import ExportPreview from './ExportPreview';
import ExportOTPDialog from './ExportOTPDialog';
import { OlympiadSubject } from '@/hooks/useOlympiadProjects';
import { useSecurityMonitoring } from '@/hooks/useSecurityMonitoring';
import { useCSRFToken } from '@/hooks/useCSRFToken';
import {
  ReportType,
  ReportFilters,
  fetchSchoolsForReport,
  fetchStudentRegistrationsForReport,
  fetchSchoolBreakdownCounts,
  generateCSV,
  downloadCSV,
  logExportAction,
} from '@/utils/reportGenerator';

interface ReportBuilderProps {
  projectId: string;
  subjects: OlympiadSubject[];
}

const ReportBuilder = ({ projectId, subjects }: ReportBuilderProps) => {
  const [reportType, setReportType] = useState<ReportType>('schools_summary');
  const [filters, setFilters] = useState<ReportFilters>({
    schoolIds: [],
    subjectIds: [],
    classes: [],
    districts: [],
    states: [],
    boards: [],
    nameListStatus: [],
  });
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    'ss_no', 'school_name', 'total_participants'
  ]);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showOtpDialog, setShowOtpDialog] = useState(false);

  const { logSecurityEvent } = useSecurityMonitoring();
  const { token, validateToken } = useCSRFToken();

  const reportTypes: { value: ReportType; label: string; description: string }[] = [
    { value: 'schools_summary', label: 'Schools Summary', description: 'Basic school info with total participants' },
    { value: 'schools_classwise', label: 'Schools Class-wise', description: 'Schools with class-wise participant breakdown' },
    { value: 'schools_subjectwise', label: 'Schools Subject-wise', description: 'Schools with subject-wise participant breakdown' },
    { value: 'student_registrations', label: 'Student Registrations', description: 'Detailed student list with names and registration numbers' },
    { value: 'custom', label: 'Custom Report', description: 'Choose all columns and filters freely' },
  ];

  // Set default columns based on report type
  const handleReportTypeChange = (type: ReportType) => {
    setReportType(type);
    setPreviewData([]);
    
    switch (type) {
      case 'schools_summary':
        setSelectedColumns(['ss_no', 'school_name', 'district', 'total_participants']);
        break;
      case 'schools_classwise':
        setSelectedColumns([
          'ss_no', 'school_name', 'total_participants',
          'lkg_count', 'ukg_count', 'class_1_count', 'class_2_count',
          'class_3_count', 'class_4_count', 'class_5_count', 'class_6_count',
          'class_7_count', 'class_8_count'
        ]);
        break;
      case 'schools_subjectwise':
        setSelectedColumns([
          'ss_no', 'school_name', 'total_participants',
          ...subjects.map(s => `subject_${s.subject_code}_count`)
        ]);
        break;
      case 'student_registrations':
        setSelectedColumns([
          'registration_number', 'student_name', 'student_class',
          'subject_name', 'school_name', 'ss_no'
        ]);
        break;
      case 'custom':
        // Keep current selection
        break;
    }
  };

  const generatePreview = useCallback(async () => {
    setIsLoading(true);
    try {
      let data: any[] = [];

      if (reportType === 'student_registrations') {
        data = await fetchStudentRegistrationsForReport(projectId, filters);
      } else {
        // Fetch base school data
        const schools = await fetchSchoolsForReport(projectId, filters);
        
        if (reportType === 'schools_classwise' || reportType === 'schools_subjectwise' || reportType === 'custom') {
          // Fetch breakdown counts
          const schoolIds = schools.map(s => s.id);
          const breakdownMap = await fetchSchoolBreakdownCounts(projectId, schoolIds, subjects);
          
          // Merge counts into school data
          data = schools.map(school => {
            const breakdown = breakdownMap.get(school.id);
            const row: any = { ...school };
            
            if (breakdown) {
              // Add class counts
              row.lkg_count = breakdown.classCounts['LKG'] || 0;
              row.ukg_count = breakdown.classCounts['UKG'] || 0;
              row.class_1_count = breakdown.classCounts['1'] || 0;
              row.class_2_count = breakdown.classCounts['2'] || 0;
              row.class_3_count = breakdown.classCounts['3'] || 0;
              row.class_4_count = breakdown.classCounts['4'] || 0;
              row.class_5_count = breakdown.classCounts['5'] || 0;
              row.class_6_count = breakdown.classCounts['6'] || 0;
              row.class_7_count = breakdown.classCounts['7'] || 0;
              row.class_8_count = breakdown.classCounts['8'] || 0;
              
              // Add subject counts
              for (const subject of subjects) {
                row[`subject_${subject.subject_code}_count`] = breakdown.subjectCounts[subject.subject_code] || 0;
              }
            }
            
            return row;
          });
        } else {
          data = schools;
        }
      }

      setPreviewData(data);
      toast.success(`Preview generated: ${data.length} records found`);
    } catch (error) {
      console.error('Error generating preview:', error);
      toast.error('Failed to generate preview');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, reportType, filters, subjects]);

  const handleExport = async () => {
    if (previewData.length === 0) {
      toast.error('Please generate preview first');
      return;
    }
    if (selectedColumns.length === 0) {
      toast.error('Please select at least one column');
      return;
    }
    // Require OTP verification for export
    setShowOtpDialog(true);
  };

  const performExport = async () => {
    // Validate CSRF token before proceeding
    if (token) {
      const csrfValid = await validateToken(token);
      if (!csrfValid) {
        toast.error('Session validation failed. Please refresh and try again.');
        return;
      }
    }

    setIsExporting(true);
    try {
      const columns = selectedColumns.map(key => {
        const columnLabels: Record<string, string> = {
          ss_no: 'SS No',
          school_name: 'School Name',
          district: 'District',
          state: 'State',
          board: 'Board',
          contact_person_name: 'Contact Person',
          mobile1: 'Mobile 1',
          mobile2: 'WhatsApp No.',
          email: 'Email',
          total_participants: 'Total Participants',
          payment_status: 'Payment Status',
          name_list_status: 'Name List Status',
          registration_number: 'Registration Number',
          student_name: 'Student Name',
          student_class: 'Class',
          subject_name: 'Subject',
          subject_code: 'Subject Code',
          roll_number: 'Roll Number',
          lkg_count: 'LKG',
          ukg_count: 'UKG',
          class_1_count: 'Class 1',
          class_2_count: 'Class 2',
          class_3_count: 'Class 3',
          class_4_count: 'Class 4',
          class_5_count: 'Class 5',
          class_6_count: 'Class 6',
          class_7_count: 'Class 7',
          class_8_count: 'Class 8',
        };
        
        // Handle subject columns dynamically
        if (key.startsWith('subject_') && key.endsWith('_count')) {
          const code = key.replace('subject_', '').replace('_count', '');
          const subject = subjects.find(s => s.subject_code === code);
          return { key, label: subject ? `${subject.subject_name} (${code})` : code };
        }
        
        return { key, label: columnLabels[key] || key };
      });

      const csvContent = generateCSV(previewData, columns);
      const filename = `export_${reportType}_${new Date().toISOString().split('T')[0]}.csv`;
      
      downloadCSV(csvContent, filename);
      
      // Log the export action
      await logExportAction(
        reportType === 'student_registrations' ? 'student_registrations' : 'schools',
        previewData.length,
        `Advanced Export: ${reportType}`
      );

      await logSecurityEvent('data_export', {
        table_name: reportType === 'student_registrations' ? 'student_registrations' : 'schools',
        new_values: { report_type: reportType, record_count: previewData.length, filename },
      }, 'medium');

      toast.success(`Exported ${previewData.length} records to ${filename}`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  const getColumnConfigs = () => {
    return selectedColumns.map(key => {
      const labels: Record<string, string> = {
        ss_no: 'SS No',
        school_name: 'School Name',
        district: 'District',
        state: 'State',
        board: 'Board',
        contact_person_name: 'Contact Person',
        mobile1: 'Mobile 1',
        mobile2: 'Mobile 2',
        email: 'Email',
        total_participants: 'Total',
        payment_status: 'Payment',
        name_list_status: 'Name List',
        registration_number: 'Reg No',
        student_name: 'Student Name',
        student_class: 'Class',
        subject_name: 'Subject',
        subject_code: 'Code',
        roll_number: 'Roll No',
        lkg_count: 'LKG',
        ukg_count: 'UKG',
        class_1_count: '1',
        class_2_count: '2',
        class_3_count: '3',
        class_4_count: '4',
        class_5_count: '5',
        class_6_count: '6',
        class_7_count: '7',
        class_8_count: '8',
      };
      
      if (key.startsWith('subject_') && key.endsWith('_count')) {
        const code = key.replace('subject_', '').replace('_count', '');
        const subject = subjects.find(s => s.subject_code === code);
        return { key, label: subject ? `${subject.subject_name} (${code})` : code };
      }
      
      return { key, label: labels[key] || key };
    });
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Report Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm">1</span>
            Select Report Type
          </CardTitle>
          <CardDescription>Choose the type of report you want to generate</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={reportType} onValueChange={(v) => handleReportTypeChange(v as ReportType)}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reportTypes.map(type => (
                <div key={type.value} className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value={type.value} id={type.value} className="mt-1" />
                  <div>
                    <Label htmlFor={type.value} className="font-medium cursor-pointer">
                      {type.label}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">{type.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Step 2: Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm">2</span>
              Apply Filters
            </CardTitle>
            <CardDescription>Filter the data by selecting specific criteria</CardDescription>
          </CardHeader>
          <CardContent>
            <FilterSection
              projectId={projectId}
              subjects={subjects}
              filters={filters}
              onFiltersChange={setFilters}
            />
          </CardContent>
        </Card>

        {/* Step 3: Columns */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm">3</span>
              Select Columns
            </CardTitle>
            <CardDescription>Choose which columns to include in the export</CardDescription>
          </CardHeader>
          <CardContent>
            <ColumnSelector
              reportType={reportType}
              subjects={subjects}
              selectedColumns={selectedColumns}
              onColumnsChange={setSelectedColumns}
            />
          </CardContent>
        </Card>
      </div>

      {/* Step 4: Preview & Export */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm">4</span>
            Preview & Export
          </CardTitle>
          <CardDescription>Generate a preview and export to CSV</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button onClick={generatePreview} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate Preview
                </>
              )}
            </Button>
            <Button 
              onClick={handleExport} 
              disabled={isExporting || previewData.length === 0}
              variant="default"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export as CSV
                </>
              )}
            </Button>
          </div>

          <Separator />

          <ExportPreview
            data={previewData}
            columns={getColumnConfigs()}
            isLoading={isLoading}
            totalCount={previewData.length}
          />
        </CardContent>
      </Card>

      {/* OTP Dialog */}
      <ExportOTPDialog
        isOpen={showOtpDialog}
        onClose={() => setShowOtpDialog(false)}
        onVerified={() => {
          setShowOtpDialog(false);
          performExport();
        }}
      />
    </div>
  );
};

export default ReportBuilder;
