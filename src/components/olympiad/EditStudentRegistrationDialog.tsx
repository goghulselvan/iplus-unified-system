import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useCorrectStudentRegistration } from '@/hooks/useStudentRegistrations';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { stripSubjectPrefix } from '@/utils/registrationNumberFormatter';

interface EditStudentRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration: {
    id: string;
    student_name: string;
    student_class: string;
    registration_number_generated?: string;
    project_id: string;
    student_subjects?: Array<{
      subject_id: string;
      olympiad_subjects: {
        id: string;
        subject_name: string;
        subject_code: string;
      };
    }>;
  };
}

export const EditStudentRegistrationDialog: React.FC<EditStudentRegistrationDialogProps> = ({
  open,
  onOpenChange,
  registration,
}) => {
  const [newClass, setNewClass] = useState(registration.student_class);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    registration.student_subjects?.map(ss => ss.subject_id) || []
  );
  const [reason, setReason] = useState('Data entry correction');
  const correctMutation = useCorrectStudentRegistration();

  // Fetch available subjects for the project and class
  const { data: availableSubjects = [] } = useQuery({
    queryKey: ['olympiad-subjects', registration.project_id, newClass],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('olympiad_subjects')
        .select('*')
        .eq('project_id', registration.project_id)
        .eq('is_active', true)
        .contains('applicable_classes', [newClass])
        .order('subject_code');

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!registration.project_id,
  });

  useEffect(() => {
    setNewClass(registration.student_class);
    setSelectedSubjectIds(registration.student_subjects?.map(ss => ss.subject_id) || []);
    setReason('Data entry correction');
  }, [registration, open]);

  // Update selected subjects when class changes
  useEffect(() => {
    if (newClass !== registration.student_class) {
      // Clear subject selection when class changes
      setSelectedSubjectIds([]);
    }
  }, [newClass, registration.student_class]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newClass.trim() || selectedSubjectIds.length === 0) {
      return;
    }

    // Only send changed values
    const hasClassChanged = newClass !== registration.student_class;
    const currentSubjectIds = registration.student_subjects?.map(ss => ss.subject_id).sort() || [];
    const newSubjectIdsSorted = [...selectedSubjectIds].sort();
    const hasSubjectsChanged = JSON.stringify(currentSubjectIds) !== JSON.stringify(newSubjectIdsSorted);

    if (!hasClassChanged && !hasSubjectsChanged) {
      return;
    }

    correctMutation.mutate(
      {
        registrationId: registration.id,
        newClass: hasClassChanged ? newClass : undefined,
        newSubjectIds: hasSubjectsChanged ? selectedSubjectIds : undefined,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  const toggleSubject = (subjectId: string) => {
    setSelectedSubjectIds(prev =>
      prev.includes(subjectId)
        ? prev.filter(id => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const hasChanges = 
    newClass !== registration.student_class ||
    JSON.stringify([...selectedSubjectIds].sort()) !== 
    JSON.stringify((registration.student_subjects?.map(ss => ss.subject_id) || []).sort());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Student Registration</DialogTitle>
          <DialogDescription>
            Modify class or subjects for this student. A new registration number will be generated.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Current Info */}
            <div className="rounded-lg border p-4 bg-muted/50 space-y-2">
              <div className="text-sm font-medium">Current Registration</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Student:</span>{' '}
                  <span className="font-medium">{registration.student_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Class:</span>{' '}
                  <span className="font-medium">{registration.student_class}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Subjects:</span>{' '}
                  <div className="flex gap-2 mt-1">
                    {registration.student_subjects?.map(ss => (
                      <Badge key={ss.subject_id} variant="secondary">
                        {ss.olympiad_subjects.subject_code} - {ss.olympiad_subjects.subject_name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Registration #:</span>{' '}
                  <span className="font-mono text-sm font-medium">
                    {stripSubjectPrefix(registration.registration_number_generated)}
                  </span>
                </div>
              </div>
            </div>

            {/* Warning */}
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> Changing class or subjects will generate a NEW registration number.
                The old registration number will be retired. Please regenerate and resend the student name list PDF to the school after correction.
              </AlertDescription>
            </Alert>

            {/* Edit Class */}
            <div className="space-y-2">
              <Label htmlFor="new-class">Student Class</Label>
              <select
                id="new-class"
                value={newClass}
                onChange={(e) => setNewClass(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                required
              >
                <option value="">Select class</option>
                <option value="LKG">LKG</option>
                <option value="UKG">UKG</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(cls => (
                  <option key={cls} value={cls.toString()}>{cls}</option>
                ))}
              </select>
            </div>

            {/* Edit Subjects */}
            <div className="space-y-3">
              <Label>Select Subjects</Label>
              <div className="rounded-lg border p-4 space-y-2">
                {availableSubjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {newClass ? 'No subjects available for this class' : 'Select a class to see available subjects'}
                  </p>
                ) : (
                  availableSubjects.map((subject) => (
                    <div key={subject.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`subject-${subject.id}`}
                        checked={selectedSubjectIds.includes(subject.id)}
                        onCheckedChange={() => toggleSubject(subject.id)}
                      />
                      <label
                        htmlFor={`subject-${subject.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        <Badge variant="outline" className="mr-2">
                          {subject.subject_code}
                        </Badge>
                        {subject.subject_name}
                      </label>
                    </div>
                  ))
                )}
              </div>
              {selectedSubjectIds.length === 0 && (
                <p className="text-sm text-destructive">Please select at least one subject</p>
              )}
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Correction Reason</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Data entry error - wrong class entered"
                rows={2}
                required
              />
            </div>

            {/* Changes Preview */}
            {hasChanges && (
              <div className="rounded-lg border p-4 bg-primary/5 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="w-4 h-4" />
                  Changes to be applied:
                </div>
                {newClass !== registration.student_class && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Class:</span>{' '}
                    <span className="line-through">{registration.student_class}</span>
                    {' → '}
                    <span className="font-medium text-primary">{newClass}</span>
                  </div>
                )}
                {JSON.stringify([...selectedSubjectIds].sort()) !== 
                 JSON.stringify((registration.student_subjects?.map(ss => ss.subject_id) || []).sort()) && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Subjects:</span> Will be updated
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={correctMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={
                correctMutation.isPending || 
                !newClass.trim() || 
                selectedSubjectIds.length === 0 ||
                !hasChanges
              }
            >
              {correctMutation.isPending ? 'Correcting...' : 'Confirm Correction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
