import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { OlympiadSubject } from '@/hooks/useOlympiadProjects';

export interface ColumnConfig {
  key: string;
  label: string;
  group: 'basic' | 'contact' | 'class' | 'subject' | 'status' | 'student';
}

interface ColumnSelectorProps {
  reportType: string;
  subjects: OlympiadSubject[];
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
}

const ColumnSelector = ({ reportType, subjects, selectedColumns, onColumnsChange }: ColumnSelectorProps) => {
  const getAvailableColumns = (): ColumnConfig[] => {
    const isStudentReport = reportType === 'student_registrations';
    
    if (isStudentReport) {
      return [
        { key: 'registration_number', label: 'Registration Number', group: 'student' },
        { key: 'student_name', label: 'Student Name', group: 'student' },
        { key: 'student_class', label: 'Class', group: 'student' },
        { key: 'subject_name', label: 'Subject', group: 'student' },
        { key: 'subject_code', label: 'Subject Code', group: 'student' },
        { key: 'roll_number', label: 'Roll Number', group: 'student' },
        { key: 'school_name', label: 'School Name', group: 'basic' },
        { key: 'ss_no', label: 'SS No', group: 'basic' },
        { key: 'district', label: 'District', group: 'basic' },
        { key: 'state', label: 'State', group: 'basic' },
      ];
    }

    // School-based reports
    const baseColumns: ColumnConfig[] = [
      { key: 'ss_no', label: 'SS No', group: 'basic' },
      { key: 'school_name', label: 'School Name', group: 'basic' },
      { key: 'district', label: 'District', group: 'basic' },
      { key: 'state', label: 'State', group: 'basic' },
      { key: 'board', label: 'Board', group: 'basic' },
      { key: 'contact_person_name', label: 'Contact Person', group: 'contact' },
      { key: 'mobile1', label: 'Mobile 1', group: 'contact' },
      { key: 'mobile2', label: 'WhatsApp No.', group: 'contact' },
      { key: 'email', label: 'Email', group: 'contact' },
      { key: 'total_participants', label: 'Total Participants', group: 'basic' },
      { key: 'payment_status', label: 'Payment Status', group: 'status' },
      { key: 'name_list_status', label: 'Name List Status', group: 'status' },
    ];

    // Add class columns for class-wise reports
    if (reportType === 'schools_classwise' || reportType === 'custom') {
      const classColumns: ColumnConfig[] = [
        { key: 'lkg_count', label: 'LKG', group: 'class' },
        { key: 'ukg_count', label: 'UKG', group: 'class' },
        { key: 'class_1_count', label: 'Class 1', group: 'class' },
        { key: 'class_2_count', label: 'Class 2', group: 'class' },
        { key: 'class_3_count', label: 'Class 3', group: 'class' },
        { key: 'class_4_count', label: 'Class 4', group: 'class' },
        { key: 'class_5_count', label: 'Class 5', group: 'class' },
        { key: 'class_6_count', label: 'Class 6', group: 'class' },
        { key: 'class_7_count', label: 'Class 7', group: 'class' },
        { key: 'class_8_count', label: 'Class 8', group: 'class' },
      ];
      baseColumns.push(...classColumns);
    }

    // Add subject columns for subject-wise reports
    if (reportType === 'schools_subjectwise' || reportType === 'custom') {
      const subjectColumns: ColumnConfig[] = subjects.map(s => ({
        key: `subject_${s.subject_code}_count`,
        label: `${s.subject_name} (${s.subject_code})`,
        group: 'subject' as const,
      }));
      baseColumns.push(...subjectColumns);
    }

    return baseColumns;
  };

  const columns = getAvailableColumns();
  
  const groupedColumns = columns.reduce((acc, col) => {
    if (!acc[col.group]) acc[col.group] = [];
    acc[col.group].push(col);
    return acc;
  }, {} as Record<string, ColumnConfig[]>);

  const handleToggle = (key: string, checked: boolean) => {
    if (checked) {
      onColumnsChange([...selectedColumns, key]);
    } else {
      onColumnsChange(selectedColumns.filter(k => k !== key));
    }
  };

  const selectAll = () => {
    onColumnsChange(columns.map(c => c.key));
  };

  const clearAll = () => {
    onColumnsChange([]);
  };

  const selectGroup = (group: string) => {
    const groupKeys = columns.filter(c => c.group === group).map(c => c.key);
    const newSelected = [...new Set([...selectedColumns, ...groupKeys])];
    onColumnsChange(newSelected);
  };

  const groupLabels: Record<string, string> = {
    basic: 'Basic Information',
    contact: 'Contact Details',
    class: 'Class-wise Counts',
    subject: 'Subject-wise Counts',
    status: 'Status Fields',
    student: 'Student Details',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={selectAll}>
          Select All
        </Button>
        <Button variant="outline" size="sm" onClick={clearAll}>
          Clear All
        </Button>
      </div>

      <div className="space-y-4">
        {Object.entries(groupedColumns).map(([group, cols]) => (
          <div key={group} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground">
                {groupLabels[group] || group}
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectGroup(group)}
                className="text-xs h-6"
              >
                Select Group
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {cols.map(col => (
                <div key={col.key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`col-${col.key}`}
                    checked={selectedColumns.includes(col.key)}
                    onCheckedChange={(checked) => handleToggle(col.key, checked as boolean)}
                  />
                  <Label htmlFor={`col-${col.key}`} className="text-sm cursor-pointer">
                    {col.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t">
        <p className="text-sm text-muted-foreground">
          {selectedColumns.length} column(s) selected
        </p>
      </div>
    </div>
  );
};

export default ColumnSelector;
