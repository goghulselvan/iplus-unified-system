import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Download, Upload, FileText, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { normalizeSchoolData, findMatchingActiveBoard } from '@/utils/dataHelpers';

const BulkSchoolImport = () => {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  // Helper function to convert text to title case
  const toTitleCase = (str: string) => {
    if (!str) return str;
    return str.toLowerCase().replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  };

  // Helper function to clean and validate phone numbers
  const cleanPhoneNumber = (phone: string) => {
    if (!phone) return '';
    return phone.replace(/[^\d]/g, '').substring(0, 10);
  };

  // Helper function to validate email
  const validateEmail = (email: string) => {
    if (!email) return '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim().toLowerCase()) ? email.trim().toLowerCase() : '';
  };

  const downloadSchoolTemplate = () => {
    const csvContent = [
      ['SS No*', 'School Name*', 'School Address*', 'State*', 'District*', 'Board*', 'Pincode', 'Mobile1', 'Mobile2', 'Email', 'Contact Person'],
      ['1001', 'Example High School', '123 Main Street, City', 'Tamil Nadu', 'Chennai', 'CBSE', '123456', '9876543210', '9876543211', 'school@example.com', 'John Doe'],
      ['1002', 'Sample Secondary School', '456 Park Avenue, Town', 'Tamil Nadu', 'Coimbatore', 'Matriculation', '654321', '9876543212', '', 'info@sample.edu', 'Jane Smith'],
      ['1003', 'Another School', '789 Oak Street, Village', 'Tamil Nadu', 'Madurai', 'TN-N&P', '987654', '9876543213', '', 'contact@another.edu', 'Bob Wilson']
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `school_bulk_import_template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Success',
      description: 'School import template downloaded successfully'
    });
  };

  const processBulkSchoolImport = async () => {
    if (!importFile) {
      toast({
        title: 'Error',
        description: 'Please select a CSV file to import',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);
    try {
      // Get active boards from board management
      const { data: activeBoards, error: boardError } = await supabase
        .from('boards')
        .select('board_name')
        .eq('is_active', true);

      if (boardError) throw boardError;
      
      const activeBoardNames = activeBoards?.map(b => b.board_name) || [];
      // Create a new FileReader to avoid permission issues
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            resolve(result);
          } else {
            reject(new Error('Failed to read file as text'));
          }
        };
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsText(importFile);
      });
      
      // Proper CSV parsing that handles multi-line quoted fields
      const parseCSV = (text: string) => {
        const rows: string[][] = [];
        let current = '';
        let inQuotes = false;
        let currentRow: string[] = [];
        
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const nextChar = text[i + 1];
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              // Escaped quote
              current += '"';
              i++; // Skip next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            // End of field
            currentRow.push(current.trim());
            current = '';
          } else if ((char === '\n' || char === '\r') && !inQuotes) {
            // End of row
            if (current.trim() || currentRow.length > 0) {
              currentRow.push(current.trim());
              if (currentRow.some(field => field.length > 0)) {
                rows.push(currentRow);
              }
              currentRow = [];
              current = '';
            }
          } else if (char !== '\r') {
            // Regular character (skip \r)
            current += char;
          }
        }
        
        // Add last field and row if not empty
        if (current.trim() || currentRow.length > 0) {
          currentRow.push(current.trim());
          if (currentRow.some(field => field.length > 0)) {
            rows.push(currentRow);
          }
        }
        
        return rows;
      };

      const allRows = parseCSV(text);
      
      if (allRows.length < 2) {
        throw new Error('CSV file must contain at least a header row and one data row');
      }

      // ============================================
      // PHASE 1: PARSE AND VALIDATE ALL ROWS FIRST
      // No database operations until all validations pass
      // ============================================
      
      const parsedSchools: Array<{
        rowIndex: number;
        rawBoard: string;
        data: ReturnType<typeof normalizeSchoolData>;
      }> = [];
      
      const invalidBoards: Array<{ row: number; ssNo: number; board: string }> = [];
      
      // First pass: Parse all rows and collect board information
      for (let index = 0; index < allRows.slice(1).length; index++) {
        const values = allRows[index + 1]; // +1 to skip header
        const rowNumber = index + 2; // Excel row number (1-based + header)
        
        if (values.length < 6) {
          throw new Error(`Row ${rowNumber}: Only ${values.length} values found, need at least 6 (SS No, School Name, Address, State, District, Board)`);
        }

        // Check if any of the first 6 required fields are empty
        const requiredFields = ['SS No', 'School Name', 'Address', 'State', 'District', 'Board'];
        for (let i = 0; i < 6; i++) {
          if (!values[i] || values[i].trim() === '') {
            throw new Error(`Row ${rowNumber}: ${requiredFields[i]} is empty or missing`);
          }
        }

        const ssNo = parseInt(values[0]);
        if (isNaN(ssNo)) {
          throw new Error(`Row ${rowNumber}: SS No must be a valid number`);
        }

        const rawBoard = toTitleCase(values[5]);
        
        const rawSchoolData = {
          ss_no: ssNo,
          school_name: toTitleCase(values[1]),
          school_address: toTitleCase(values[2]),
          state: toTitleCase(values[3]),
          district: toTitleCase(values[4]),
          board: rawBoard,
          pincode: values[6] || '',
          mobile1: cleanPhoneNumber(values[7] || ''),
          mobile2: cleanPhoneNumber(values[8] || ''),
          email: validateEmail(values[9] || ''),
          contact_person_name: toTitleCase(values[10] || ''),
          courier_status: 'Sent' as const,
          contacted: 'No' as const,
          consent_form_requested: 'No' as const,
          registration_status: 'Pending' as const,
          name_list_status: 'Pending' as const,
          payment_status: 'Pending' as const,
          question_paper_sent: 'Not Sent' as const,
          answer_sheet_status: 'Waiting' as const,
          result_status: 'Not Sent' as const,
        };

        const normalizedData = normalizeSchoolData(rawSchoolData);
        
        parsedSchools.push({
          rowIndex: rowNumber,
          rawBoard: rawBoard,
          data: normalizedData,
        });
      }

      // ============================================
      // PHASE 2: VALIDATE ALL BOARDS BEFORE ANY DB OPERATIONS
      // ============================================
      
      for (const school of parsedSchools) {
        if (activeBoardNames.length > 0) {
          const matchingBoard = findMatchingActiveBoard(school.rawBoard, activeBoardNames, school.data.state);
          if (!matchingBoard) {
            invalidBoards.push({
              row: school.rowIndex,
              ssNo: school.data.ss_no,
              board: school.rawBoard,
            });
          } else {
            // Update with the matched board name
            school.data.board = matchingBoard;
          }
        }
      }

      // If ANY invalid boards found, reject the ENTIRE upload
      if (invalidBoards.length > 0) {
        const boardList = [...new Set(invalidBoards.map(b => b.board))].join(', ');
        const rowList = invalidBoards.slice(0, 5).map(b => `Row ${b.row} (SS No: ${b.ssNo})`).join(', ');
        const moreRows = invalidBoards.length > 5 ? ` and ${invalidBoards.length - 5} more rows` : '';
        
        throw new Error(
          `IMPORT CANCELLED: ${invalidBoards.length} row(s) have invalid boards.\n\n` +
          `Invalid board(s): ${boardList}\n\n` +
          `Affected rows: ${rowList}${moreRows}\n\n` +
          `Please add the missing board(s) to Board Management first, then retry the import.`
        );
      }

      // ============================================
      // PHASE 3: VALIDATE ALL REQUIRED FIELDS
      // ============================================
      
      const schools = parsedSchools.map(p => p.data);
      
      for (let i = 0; i < schools.length; i++) {
        const school = schools[i];
        if (!school.school_name || !school.school_address || !school.state || !school.district || !school.board) {
          throw new Error(`Row ${i + 2}: Missing required fields (School Name, Address, State, District, or Board)`);
        }
      }

      let successCount = 0;
      let updateCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < schools.length; i++) {
        const school = schools[i];
        
        try {
          // Check if school with this SS No already exists
          const { data: existingSchool, error: findError } = await supabase
            .from('schools')
            .select('id, school_name')
            .eq('ss_no', school.ss_no)
            .maybeSingle();

          if (findError) {
            throw findError;
          }

          if (existingSchool) {
            // Normalize the update data
            const updateData = normalizeSchoolData({
              school_name: school.school_name,
              school_address: school.school_address,
              state: school.state,
              district: school.district,
              board: school.board,
              pincode: school.pincode,
              mobile1: school.mobile1,
              mobile2: school.mobile2,
              email: school.email,
              contact_person_name: school.contact_person_name,
            });

            // Update existing school using safe update function
            const { error: updateError } = await supabase.rpc('update_school_with_manual_edit', {
              p_school_id: existingSchool.id,
              p_updates: updateData
            });

            if (updateError) {
              throw updateError;
            }

            // Log the activity
            const { data: user } = await supabase.auth.getUser();
            if (user.user) {
              await supabase
                .from('activity_logs')
                .insert({
                  school_id: existingSchool.id,
                  user_id: user.user.id,
                  activity_type: 'bulk_update',
                  field_name: 'school_details',
                  new_value: 'Updated via bulk import',
                  description: `Bulk update of school details for SS No: ${school.ss_no}`
                });
            }

            updateCount++;
          } else {
            // Create new school
            const { error: insertError } = await supabase
              .from('schools')
              .insert([school]);

            if (insertError) {
              throw insertError;
            }

            successCount++;
          }
        } catch (err: any) {
          console.error(`Error processing row ${i + 2} (SS No: ${school.ss_no}):`, err);
          errors.push(`Row ${i + 2} (SS No: ${school.ss_no}): ${err.message}`);
          errorCount++;
        }
      }

      // Show comprehensive results
      let resultMessage = '';
      if (successCount > 0) resultMessage += `${successCount} new schools created. `;
      if (updateCount > 0) resultMessage += `${updateCount} schools updated. `;
      if (errorCount > 0) resultMessage += `${errorCount} errors occurred.`;

      toast({
        title: 'Import Complete',
        description: resultMessage || 'Import completed.',
        variant: errorCount > 0 ? 'destructive' : 'default'
      });

      if (errors.length > 0 && errors.length <= 5) {
        // Show first few errors if not too many
        toast({
          title: 'Import Errors',
          description: errors.slice(0, 3).join('\n'),
          variant: 'destructive'
        });
      }

      setImportFile(null);
      setIsDialogOpen(false);
      
      // Refresh the page to show updated data
      window.location.reload();
      
    } catch (error: any) {
      toast({
        title: 'Import Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          Bulk Import Schools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Schools</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Template Download Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="h-5 w-5" />
                <span>Download Template</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Download the CSV template with the required format for bulk importing schools.
              </p>
              <Button onClick={downloadSchoolTemplate} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download School Import Template
              </Button>
            </CardContent>
          </Card>

          {/* Import Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Upload className="h-5 w-5" />
                <span>Import Schools</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="school-file">Upload CSV File</Label>
                <Input
                  id="school-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
                <div className="text-sm text-muted-foreground mt-2 space-y-1">
                  <p><strong>Required fields:</strong> SS No*, School Name*, School Address*, State*, District*, Board*</p>
                  <p><strong>Optional fields:</strong> Pincode, Mobile1, Mobile2, Email, Contact Person</p>
                  <p><strong>Board validation:</strong> Board names must match active boards in Board Management (case insensitive).</p>
                  <p><strong>Tamil Nadu boards:</strong> Use "State Board" (becomes Matriculation), "Matriculation", "TN-N&P", or "CBSE".</p>
                  <p><strong>Note:</strong> Data will be automatically formatted and validated. Existing schools (same SS No) will be updated.</p>
                </div>
              </div>

              <Button 
                onClick={processBulkSchoolImport} 
                disabled={!importFile || importing}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importing ? 'Processing...' : 'Import Schools'}
              </Button>

              {importing && (
                <div className="text-center text-sm text-muted-foreground">
                  Processing bulk import... This may take a few moments.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BulkSchoolImport;