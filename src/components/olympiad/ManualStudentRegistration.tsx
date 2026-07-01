import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateStudentRegistration } from '@/hooks/useStudentRegistrations';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ManualStudentRegistrationProps {
  schoolId: string;
  onSuccess?: () => void;
}

export const ManualStudentRegistration = ({ schoolId, onSuccess }: ManualStudentRegistrationProps) => {
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  const { data: activeProject } = useActiveProject();
  const { data: olympiadSubjects } = useOlympiadSubjects(activeProject?.id);
  const createRegistration = useCreateStudentRegistration();

  const classes = [
    'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
  ];

  // Filter subjects based on selected class
  const getFilteredSubjects = () => {
    if (!olympiadSubjects || !studentClass) return olympiadSubjects || [];
    
    const isLKGOrUKG = studentClass === 'LKG' || studentClass === 'UKG';
    
    return olympiadSubjects.filter(subject => {
      // KidsPO (subject code 9, subject_name 'KidsPO') is only for LKG/UKG
      const isKids = subject.subject_code === '9' || subject.subject_name === 'KidsPO';
      if (isKids) return isLKGOrUKG;
      return !isLKGOrUKG;
    });
  };

  const filteredSubjects = getFilteredSubjects();

  const handleSubjectChange = (subjectId: string, checked: boolean) => {
    if (checked) {
      setSelectedSubjects(prev => [...prev, subjectId]);
    } else {
      setSelectedSubjects(prev => prev.filter(id => id !== subjectId));
    }
  };

  // Reset selected subjects when class changes
  React.useEffect(() => {
    if (studentClass) {
      // Clear subjects that are not valid for the selected class
      const validSubjectIds = new Set(filteredSubjects.map(s => s.id));
      setSelectedSubjects(prev => prev.filter(id => validSubjectIds.has(id)));
    }
  }, [studentClass]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!activeProject?.id) {
      toast.error('No active project found');
      return;
    }

    if (!studentName.trim() || !studentClass || selectedSubjects.length === 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      await createRegistration.mutateAsync({
        project_id: activeProject.id,
        school_id: schoolId,
        student_name: studentName.trim(),
        student_class: studentClass,
        subject_ids: selectedSubjects,
      });

      // Reset form
      setStudentName('');
      setStudentClass('');
      setRollNumber('');
      setSelectedSubjects([]);
      
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Registration failed:', error);
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
        <CardTitle>Manual Student Registration</CardTitle>
        <CardDescription>
          Add individual students with auto-generated registration numbers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="studentName">Student Name *</Label>
            <Input
              id="studentName"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Enter student name"
              required
            />
          </div>

          <div>
            <Label htmlFor="studentClass">Class *</Label>
            <Select value={studentClass} onValueChange={setStudentClass} required>
              <SelectTrigger>
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((cls) => (
                  <SelectItem key={cls} value={cls}>
                    {cls}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="rollNumber">Roll Number (Optional)</Label>
            <Input
              id="rollNumber"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="Enter roll number"
            />
          </div>

          <div>
            <Label>Olympiad Subjects *</Label>
            {!studentClass && (
              <p className="text-sm text-muted-foreground mt-1 mb-2">
                Please select a class first to see available subjects
              </p>
            )}
            <div className="space-y-2 mt-2">
              {filteredSubjects?.map((subject) => (
                <div key={subject.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={subject.id}
                    checked={selectedSubjects.includes(subject.id)}
                    onCheckedChange={(checked) => 
                      handleSubjectChange(subject.id, checked as boolean)
                    }
                  />
                  <Label htmlFor={subject.id}>
                    {subject.subject_name} (Code: {subject.subject_code})
                  </Label>
                </div>
              ))}
            </div>
            {studentClass && filteredSubjects?.length === 0 && (
              <p className="text-sm text-destructive mt-1">
                No subjects available for the selected class
              </p>
            )}
            {selectedSubjects.length === 0 && studentClass && filteredSubjects && filteredSubjects.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                Please select at least one subject
              </p>
            )}
          </div>

          <Button 
            type="submit" 
            disabled={createRegistration.isPending || !studentName.trim() || !studentClass || selectedSubjects.length === 0}
            className="w-full"
          >
            {createRegistration.isPending ? 'Creating Registration...' : 'Create Registration'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};