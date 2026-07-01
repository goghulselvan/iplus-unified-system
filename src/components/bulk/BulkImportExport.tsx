import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Upload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWorkflow } from '@/hooks/useWorkflow';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import BulkSchoolImport from './BulkSchoolImport';
import ExportOTPDialog from '@/components/export/ExportOTPDialog';

const BulkImportExport = () => {
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [showOTPDialog, setShowOTPDialog] = useState(false);
  const { getWorkflowStages } = useWorkflow();
  const { profile } = useAuth();
  const { toast } = useToast();

  const stages = getWorkflowStages();
  const selectedStageData = stages.find(s => s.key === selectedWorkflow);

  const downloadTemplate = () => {
    if (!selectedWorkflow || !selectedStatus) {
      toast({
        title: 'Error',
        description: 'Please select both workflow stage and status',
        variant: 'destructive',
      });
      return;
    }

    const stageName = selectedStageData?.label || selectedWorkflow;
    const csvContent = [
      ['SS No', 'School Name', `${stageName}`],
      ['1001', 'Example School 1', selectedStatus],
      ['1002', 'Example School 2', selectedStatus]
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk_update_template_${selectedWorkflow}_${selectedStatus}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Success',
      description: 'Template downloaded successfully'
    });
  };

  const handleExportClick = () => {
    if (profile?.role !== 'superadmin') {
      toast({
        title: 'Access Denied',
        description: 'Only superadmins can export data',
        variant: 'destructive',
      });
      return;
    }
    setShowOTPDialog(true);
  };

  const exportAllSchools = async () => {
    try {
      // Remove the limit to get ALL schools
      let allSchools: any[] = [];
      let from = 0;
      const size = 1000; // Keep pagination size for efficiency
      
      while (true) {
        const { data: schools, error } = await supabase
          .from('schools')
          .select('*')
          .range(from, from + size - 1)
          .order('ss_no');

        if (error) throw error;
        
        if (!schools || schools.length === 0) break;
        
        allSchools = [...allSchools, ...schools];
        
        if (schools.length < size) break;
        from += size;
      }

      if (allSchools.length === 0) {
        toast({
          title: 'Info',
          description: 'No schools found to export',
        });
        return;
      }

      const headers = [
        'SS No', 'School Name', 'Address', 'District', 'Board', 'Pincode',
        'Mobile1', 'Mobile2', 'Email', 'Contact Person',
        'Courier Status', 'Contacted', 'Registration Interest',
        'Consent Form Requested', 'Consent Form Sent', 'Registration Status', 'Name List Status',
        'Payment Status', 'Payment Mode', 'Payment Date', 'Payment Amount',
        'Question Paper Sent', 'Answer Sheet Status', 'Result Status'
      ];

      const csvContent = [
        headers,
        ...allSchools.map(school => [
          school.ss_no,
          school.school_name,
          school.school_address,
          school.district,
          school.board,
          school.pincode || '',
          school.mobile1 || '',
          school.mobile2 || '',
          school.email || '',
          school.contact_person_name || '',
          school.courier_status || '',
          school.contacted || '',
          school.registration_interest || '',
          school.consent_form_requested || '',
          school.consent_form_sent || '',
          school.registration_status || '',
          school.name_list_status || '',
          school.payment_status || '',
          school.payment_mode || '',
          school.payment_date || '',
          school.payment_amount || '',
          school.question_paper_sent || '',
          school.answer_sheet_status || '',
          school.result_status || ''
        ])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schools_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Success',
        description: `Exported ${allSchools.length} schools successfully`
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const processBulkImport = async () => {
    if (!importFile || !selectedWorkflow || !selectedStatus) {
      toast({
        title: 'Error',
        description: 'Please select a file, workflow stage, and status',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);
    try {
      const text = await importFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      const rows = lines.slice(1).map((line, index) => {
        const values = line.split(',').map(val => val.replace(/"/g, '').trim());
        return {
          rowNumber: index + 2, // +2 because we skip header and arrays are 0-indexed
          ssNo: parseInt(values[0]),
          schoolName: values[1]?.toLowerCase() || '', // Case insensitive search
          status: values[2] || ''
        };
      });

      let successCount = 0;
      let errorCount = 0;
      const skippedRows: { rowNumber: number; reason: string; ssNo?: number; schoolName?: string }[] = [];

      for (const row of rows) {
        // Check for missing mandatory information
        if (!row.ssNo || isNaN(row.ssNo)) {
          skippedRows.push({
            rowNumber: row.rowNumber,
            reason: 'Missing or invalid SS No',
            schoolName: row.schoolName
          });
          continue;
        }

        if (!row.schoolName || row.schoolName.trim() === '') {
          skippedRows.push({
            rowNumber: row.rowNumber,
            reason: 'Missing school name',
            ssNo: row.ssNo
          });
          continue;
        }

        if (!row.status || row.status.trim() === '') {
          skippedRows.push({
            rowNumber: row.rowNumber,
            reason: 'Missing status',
            ssNo: row.ssNo,
            schoolName: row.schoolName
          });
          continue;
        }

        try {
          // Find school by SS No (case insensitive name check)
          const { data: schools, error: findError } = await supabase
            .from('schools')
            .select('id, school_name')
            .eq('ss_no', row.ssNo)
            .ilike('school_name', `%${row.schoolName}%`)
            .single();

          if (findError || !schools) {
            skippedRows.push({
              rowNumber: row.rowNumber,
              reason: 'School not found in database',
              ssNo: row.ssNo,
              schoolName: row.schoolName
            });
            continue;
          }

          // Update the workflow status
          const { error: updateError } = await supabase
            .from('schools')
            .update({ [selectedWorkflow]: selectedStatus })
            .eq('id', schools.id);

          if (updateError) {
            console.error(`Error updating school ${row.ssNo}:`, updateError);
            skippedRows.push({
              rowNumber: row.rowNumber,
              reason: 'Database update failed',
              ssNo: row.ssNo,
              schoolName: row.schoolName
            });
          } else {
            // Log the activity
            await supabase
              .from('activity_logs')
              .insert({
                school_id: schools.id,
                user_id: (await supabase.auth.getUser()).data.user?.id || '',
                activity_type: 'status_update',
                field_name: selectedWorkflow,
                new_value: selectedStatus,
                description: `Bulk update via import`
              });
            successCount++;
          }
        } catch (err) {
          console.error(`Error processing row for SS No ${row.ssNo}:`, err);
          skippedRows.push({
            rowNumber: row.rowNumber,
            reason: 'Processing error',
            ssNo: row.ssNo,
            schoolName: row.schoolName
          });
        }
      }

      // Create detailed notification
      let toastMessage = `Successfully updated ${successCount} schools.`;
      if (skippedRows.length > 0) {
        toastMessage += ` ${skippedRows.length} rows were skipped.`;
        
        // Log detailed skip information to console for user reference
        // console.group('Skipped Rows Details:');
        // skippedRows.forEach(skip => {
        //   console.log(`Row ${skip.rowNumber}: ${skip.reason}${skip.ssNo ? ` (SS No: ${skip.ssNo})` : ''}${skip.schoolName ? ` (School: ${skip.schoolName})` : ''}`);
        // });
        // console.groupEnd();
      }

      toast({
        title: 'Import Complete',
        description: toastMessage,
        variant: skippedRows.length > 0 ? 'default' : 'default'
      });

      // Show additional toast with skip details if there are skipped rows
      if (skippedRows.length > 0) {
        setTimeout(() => {
          toast({
            title: 'Skipped Rows',
            description: `${skippedRows.length} rows skipped. Check browser console for detailed reasons.`,
            variant: 'destructive'
          });
        }, 1000);
      }

      setImportFile(null);
      setSelectedWorkflow('');
      setSelectedStatus('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Download className="h-5 w-5" />
            <span>Export Data</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile?.role === 'superadmin' ? (
            <Button onClick={handleExportClick} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Export All Schools Data
            </Button>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground text-sm">
                Export functionality is only available for superadmins
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Import Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Download Import Templates</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Workflow Stage</Label>
              <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
                <SelectTrigger>
                  <SelectValue placeholder="Select workflow stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map(stage => (
                    <SelectItem key={stage.key} value={stage.key}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedStageData && (
              <div>
                <Label>Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedStageData.options.map(option => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {profile?.role === 'superadmin' ? (
            <Button 
              onClick={downloadTemplate} 
              disabled={!selectedWorkflow || !selectedStatus}
              className="w-full"
            >
              <FileText className="h-4 w-4 mr-2" />
              Download Template for {selectedStageData?.label}
            </Button>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground text-sm">
                Template download is only available for superadmins
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk School Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Import Complete School Data</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Import complete school data including all required fields: SS No, School Name, Address, District, Board, Pincode
          </p>
          <BulkSchoolImport />
        </CardContent>
      </Card>

      {/* Bulk Status Update Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Bulk Status Updates</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Upload CSV File</Label>
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Upload a CSV file with the format: SS No, School Name, Status
            </p>
          </div>

          <Button 
            onClick={processBulkImport} 
            disabled={!importFile || !selectedWorkflow || !selectedStatus || importing}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            {importing ? 'Processing...' : 'Import and Update Status'}
          </Button>

          {importing && (
            <div className="text-center text-sm text-muted-foreground">
              Processing bulk import... This may take a few moments.
            </div>
          )}
        </CardContent>
      </Card>
      
      <ExportOTPDialog
        isOpen={showOTPDialog}
        onClose={() => setShowOTPDialog(false)}
        onVerified={exportAllSchools}
      />
    </div>
  );
};

export default BulkImportExport;