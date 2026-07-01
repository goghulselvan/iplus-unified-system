import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBulkCreateStudentRegistrations } from '@/hooks/useStudentRegistrations';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';
import { toast } from 'sonner';
import { Download, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface BulkStudentRegistrationProps {
  schoolId: string;
  onSuccess?: () => void;
}

export const BulkStudentRegistration = ({ schoolId, onSuccess }: BulkStudentRegistrationProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStatus, setCurrentStatus] = useState('');

  const { data: activeProject } = useActiveProject();
  const { data: olympiadSubjects } = useOlympiadSubjects(activeProject?.id);
  const bulkCreate = useBulkCreateStudentRegistrations();

  const downloadTemplate = () => {
    const headers = ['Student Name', 'Class', 'Olympiad'];
    const sampleData = [
      'S RITHUSHANA,1,EPO',
      'A SARAN,1,EPO',
      'T M NILAN,1,EPO',
      'K KAMALLAKANNAN,1,EPO',
      'T MEHAVARSAN,2,EPO',
      'M ARADHANA,2,EPO',
      'M DHASWANTH,3,EPO',
      'B YAZHINI,3,EPO'
    ];
    
    const csvContent = [headers.join(','), ...sampleData].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_registration_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const parseCSV = (csv: string): any[] => {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    
    return lines.slice(1).map(line => {
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      
      const row: any = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.replace(/\s+/g, '_').toLowerCase();
        row[normalizedHeader] = values[index] || '';
      });
      return row;
    });
  };

  const validateRow = (row: any, index: number): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    // Get field values with multiple possible header formats
    const studentName = (row.student_name || row['student_name'] || '').toString().trim();
    const studentClass = (row.class || row['class'] || row.student_class || row['student_class'] || '').toString().trim();
    const olympiad = (row.olympiad || row['olympiad'] || row.olympiads || row['olympiads'] || '').toString().trim();
    
    // Validate mandatory fields
    if (!studentName) {
      errors.push(`Row ${index + 2}: Student Name is required`);
    } else if (studentName.length < 2 || studentName.length > 100) {
      errors.push(`Row ${index + 2}: Student Name must be between 2-100 characters`);
    } else if (!/^[a-zA-Z\s.'-]+$/.test(studentName)) {
      errors.push(`Row ${index + 2}: Student Name contains invalid characters (only letters, spaces, dots, hyphens, apostrophes allowed)`);
    }
    
    if (!studentClass) {
      errors.push(`Row ${index + 2}: Class is required`);
    } else {
      const validClasses = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];
      if (!validClasses.includes(studentClass.toUpperCase())) {
        errors.push(`Row ${index + 2}: Invalid class "${studentClass}". Valid classes: ${validClasses.join(', ')}`);
      }
    }
    
    if (!olympiad) {
      errors.push(`Row ${index + 2}: Olympiad is required`);
    } else {
      // Find subject by name, code, or alphabetical code
      const subject = olympiadSubjects?.find(s => 
        s.subject_name.toLowerCase() === olympiad.toLowerCase() ||
        s.subject_code.toLowerCase() === olympiad.toLowerCase() ||
        s.alphabetical_code?.toLowerCase() === olympiad.toLowerCase()
      );
      
      if (!subject) {
        const validCodes = olympiadSubjects?.map(s => s.subject_code).join(', ') || '';
        errors.push(`Row ${index + 2}: Invalid olympiad "${olympiad}". Valid codes: ${validCodes}`);
      } else {
        // Validate class-olympiad compatibility
        const normalizedClass = studentClass.toUpperCase();
        if (subject.subject_code === '5' && !['LKG', 'UKG'].includes(normalizedClass)) {
          errors.push(`Row ${index + 2}: KidsPO is only for LKG/UKG students, but class is "${studentClass}"`);
        } else if (subject.subject_code !== '5' && ['LKG', 'UKG'].includes(normalizedClass)) {
          errors.push(`Row ${index + 2}: Class "${studentClass}" students can only register for KidsPO, not "${olympiad}"`);
        }
      }
    }
    
    return { isValid: errors.length === 0, errors };
  };

  const updateProgress = (percent: number, status: string) => {
    setProgress(percent);
    setCurrentStatus(status);
  };

  const handleFileUpload = async () => {
    if (!file || !activeProject?.id || !olympiadSubjects) {
      toast.error('Please select a file and ensure project data is loaded');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setCurrentStatus('Starting upload process...');
    
    // Prevent user from leaving during upload
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Upload in progress. Are you sure you want to leave?';
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
    
    try {
      // Stage 1: Parse CSV (10% progress)
      updateProgress(10, 'Reading and parsing CSV file...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for UX
      
      const text = await file.text();
      const parsedData = parseCSV(text);
      
      if (parsedData.length === 0) {
        toast.error('No data found in the file. Please check your CSV format.');
        return;
      }
      
      updateProgress(20, `Found ${parsedData.length} rows to process...`);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Stage 2: Comprehensive validation (30% progress)
      updateProgress(30, 'Validating all data - checking mandatory fields...');
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const validationResults = parsedData.map((row, index) => validateRow(row, index));
      const allErrors = validationResults.flatMap(result => result.errors);
      
      if (allErrors.length > 0) {
        // Display detailed validation errors
        const errorSummary = `❌ Found ${allErrors.length} validation error(s):\n\n${allErrors.slice(0, 10).join('\n')}${allErrors.length > 10 ? `\n\n... and ${allErrors.length - 10} more errors.` : ''}`;
        
        toast.error('Validation failed - no data was uploaded', {
          description: errorSummary,
          duration: 10000,
        });
        return;
      }
      
      updateProgress(50, 'All validations passed! Preparing registration data...');
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Stage 3: Prepare registrations (60% progress)
      const registrations = [];
      
      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i];
        const studentName = (row.student_name || row['student_name'] || '').toString().trim();
        const studentClass = (row.class || row['class'] || row.student_class || row['student_class'] || '').toString().trim();
        const olympiad = (row.olympiad || row['olympiad'] || row.olympiads || row['olympiads'] || '').toString().trim();
        
        // Find subject (already validated above)
        const subject = olympiadSubjects.find(s => 
          s.subject_name.toLowerCase() === olympiad.toLowerCase() ||
          s.subject_code.toLowerCase() === olympiad.toLowerCase() ||
          s.alphabetical_code?.toLowerCase() === olympiad.toLowerCase()
        );
        
        registrations.push({
          project_id: activeProject.id,
          school_id: schoolId,
          student_name: studentName,
          student_class: studentClass.toUpperCase(),
          subject_ids: [subject!.id],
        });
        
        // Update progress during preparation
        const prepProgress = 60 + (i / parsedData.length) * 20;
        updateProgress(prepProgress, `Preparing registration ${i + 1} of ${parsedData.length}...`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Stage 4: Database upload (80% progress)
      updateProgress(80, 'Uploading to database and generating registration numbers...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await bulkCreate.mutateAsync(registrations);
      
      // Stage 5: Complete (100% progress)
      updateProgress(100, '✅ Upload completed successfully!');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setFile(null);
      if (onSuccess) onSuccess();
      
      toast.success(`✅ Successfully uploaded ${registrations.length} student registrations!`, {
        description: `All registrations have been created with auto-generated registration numbers.`,
        duration: 5000,
      });
      
    } catch (error) {
      console.error('Bulk upload failed:', error);
      updateProgress(0, 'Upload failed');
      toast.error('Upload failed - please try again', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred during upload',
        duration: 8000,
      });
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      setIsProcessing(false);
      setProgress(0);
      setCurrentStatus('');
    }
  };

  if (!activeProject) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">No active project found. Please create or activate a project first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Student Registration</CardTitle>
        <CardDescription>
          Upload a CSV file with Student Name, Class, Olympiad columns. Each row creates one unique registration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Button 
            onClick={downloadTemplate} 
            variant="outline" 
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Download CSV Template
          </Button>
          <p className="text-sm text-muted-foreground mt-2">
            📋 <strong>All fields are mandatory:</strong> Student Name, Class, Olympiad. Complete validation before upload.
          </p>
        </div>

        <div>
          <Label htmlFor="csvFile">Upload CSV File</Label>
          <Input
            id="csvFile"
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-1"
          />
        </div>

        {file && (
          <div className="text-sm text-muted-foreground">
            Selected file: {file.name} ({Math.round(file.size / 1024)} KB)
          </div>
        )}

        {/* Progress Bar and Status Display */}
        {isProcessing && (
          <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
              {progress === 100 ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              )}
              <span className="font-medium">Upload Progress</span>
            </div>
            
            <Progress value={progress} className="h-2" />
            
            <div className="flex justify-between items-center text-xs">
              <span className="text-blue-700 dark:text-blue-300">{currentStatus}</span>
              <span className="font-mono font-medium text-blue-800 dark:text-blue-200">{progress}%</span>
            </div>
            
            {progress < 100 && (
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-xs">
                <AlertCircle className="h-3 w-3" />
                <span>Please don't close this window or navigate away during upload</span>
              </div>
            )}
          </div>
        )}

        <Button 
          onClick={handleFileUpload}
          disabled={!file || isProcessing || bulkCreate.isPending}
          className="w-full"
        >
          <Upload className="w-4 h-4 mr-2" />
          {isProcessing || bulkCreate.isPending ? 'Processing...' : 'Validate & Upload Registrations'}
        </Button>
        
        <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-3 rounded border">
          <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">🛡️ Validation Process:</p>
          <ul className="space-y-1 text-blue-700 dark:text-blue-300">
            <li>• All mandatory fields checked</li>
            <li>• Class-olympiad compatibility verified</li>
            <li>• Student name format validation</li>
            <li>• <strong>No partial uploads</strong> - all or nothing</li>
          </ul>
        </div>

        {olympiadSubjects && olympiadSubjects.length > 0 && (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium">Available subjects:</p>
            <ul className="list-disc list-inside">
              {olympiadSubjects.map(subject => (
                <li key={subject.id}>{subject.subject_name} (Code: {subject.subject_code})</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};