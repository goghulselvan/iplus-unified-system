import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Download, Pencil, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useSchoolStudents, type SchoolStudent } from '@/hooks/useSchoolStudents';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useDeleteStudentRegistrations } from '@/hooks/useDeleteStudentRegistrations';
import { downloadCSV } from '@/utils/csvExport';
import { stripSubjectPrefix } from '@/utils/registrationNumberFormatter';
import { EditStudentRegistrationDialog } from './EditStudentRegistrationDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SchoolStudentsTableProps {
  schoolId: string;
  schoolName: string;
}

export const SchoolStudentsTable: React.FC<SchoolStudentsTableProps> = ({ schoolId, schoolName }) => {
  const { data: activeProject } = useActiveProject();
  const { data: students = [], isLoading, refetch } = useSchoolStudents(schoolId, activeProject?.id);
  const deleteRegistrations = useDeleteStudentRegistrations();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingStudent, setEditingStudent] = useState<SchoolStudent | null>(null);

  // Subject columns from active project
  const { data: subjects = [] } = useQuery({
    queryKey: ['olympiad-subjects-table', activeProject?.id],
    queryFn: async () => {
      if (!activeProject?.id) return [] as Array<{ id: string; subject_name: string; subject_code: string }>;
      const { data, error } = await supabase
        .from('olympiad_subjects')
        .select('id, subject_name, subject_code')
        .eq('project_id', activeProject.id)
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeProject?.id,
  });

  const orderedSubjects = useMemo(() => {
    return [...subjects].sort((a, b) => parseInt(a.subject_code) - parseInt(b.subject_code));
  }, [subjects]);

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      const c = (a.class_code ?? 0) - (b.class_code ?? 0);
      if (c !== 0) return c;
      return (a.student_sequence ?? 0) - (b.student_sequence ?? 0);
    });
  }, [students]);

  // Build the displayed Roll No: full STATE-DISTRICT-SCHOOL-CLASS-STUDENT
  // tail derived from any participation's registration_number. Falls back
  // to the padded student_sequence if no registration number is available.
  const getRollNoDisplay = (stu: SchoolStudent): string => {
    const withRegNo = stu.participations.find((p) => !!p.registration_number);
    if (withRegNo?.registration_number) {
      return stripSubjectPrefix(withRegNo.registration_number);
    }
    if (stu.student_sequence != null) {
      return String(stu.student_sequence).padStart(3, '0');
    }
    return '';
  };

  const totalParticipations = useMemo(
    () => students.reduce((sum, s) => sum + (s.participations?.length || 0), 0),
    [students]
  );

  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(students.map((s) => s.student_id)));
    else setSelectedIds(new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // A "legacy" row is a synthesized pseudo-student whose student_id is
  // really a student_registrations.id (the upstream RPC returns NULL for
  // student_sequence in that case). Modern rows have a real students.id.
  const isLegacy = (stu: SchoolStudent) => stu.student_sequence == null;

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    const peopleIds: string[] = [];
    const legacyRegIds: string[] = [];

    for (const s of students) {
      if (!selectedIds.has(s.student_id)) continue;
      if (isLegacy(s)) {
        // student_id field is actually the registration id for legacy rows
        legacyRegIds.push(s.student_id);
      } else {
        peopleIds.push(s.student_id);
      }
    }

    // Run the modern (people) and legacy paths separately so each
    // hits the correct RPC argument.
    if (peopleIds.length > 0) {
      await deleteRegistrations.mutateAsync({ schoolId, peopleIds });
    }
    if (legacyRegIds.length > 0) {
      await deleteRegistrations.mutateAsync({ schoolId, specificStudentIds: legacyRegIds });
    }

    setSelectedIds(new Set());
    setConfirmDelete(false);
    refetch();
  };

  const handleExportCsv = () => {
    const headers = [
      'S.No',
      'Student Name',
      'Class',
      'Roll No',
      ...orderedSubjects.map((s) => s.subject_name),
    ];

    const rows = sortedStudents.map((stu, idx) => {
      const bySubject = new Map(stu.participations.map((p) => [p.subject_id, p]));
      return [
        String(idx + 1),
        stu.student_name,
        stu.student_class,
        getRollNoDisplay(stu),
        ...orderedSubjects.map((s) => (bySubject.has(s.id) ? 'Yes' : '')),
      ];
    });

    downloadCSV(
      [headers, ...rows],
      `students_${schoolName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    );
  };

  // Build the registration object expected by EditStudentRegistrationDialog.
  // We use the student's first participation as the canonical registration
  // (in the student-centric model, all subject participations for a given
  // class share the same registration record).
  const buildEditRegistration = (stu: SchoolStudent) => {
    const firstReg = stu.participations[0];
    if (!firstReg || !activeProject) return null;
    return {
      id: firstReg.registration_id,
      student_name: stu.student_name,
      student_class: stu.student_class,
      registration_number_generated: firstReg.registration_number || undefined,
      project_id: activeProject.id,
      student_subjects: stu.participations.map((p) => ({
        subject_id: p.subject_id,
        olympiad_subjects: {
          id: p.subject_id,
          subject_name: p.subject_name,
          subject_code: p.subject_code,
        },
      })),
    };
  };

  if (!activeProject) return null;

  const editRegistration = editingStudent ? buildEditRegistration(editingStudent) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Registered Students</CardTitle>
            <CardDescription>
              {students.length} student{students.length === 1 ? '' : 's'} • {totalParticipations} participation
              {totalParticipations === 1 ? '' : 's'} for {schoolName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={students.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0 || deleteRegistrations.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading students...</p>
        ) : students.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No registered students yet. Use the form above to add students.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === students.length && students.length > 0}
                      onCheckedChange={(c) => toggleAll(c as boolean)}
                    />
                  </TableHead>
                  <TableHead className="w-16">S.No</TableHead>
                  <TableHead>Student Name</TableHead>
                  <TableHead className="w-20">Class</TableHead>
                  <TableHead className="w-24 whitespace-nowrap">Roll No</TableHead>
                  {orderedSubjects.map((s) => (
                    <TableHead key={`sub-${s.id}`} className="text-center">
                      {s.subject_name}
                    </TableHead>
                  ))}
                  <TableHead className="w-20 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStudents.map((stu, idx) => {
                  const bySubject = new Map(stu.participations.map((p) => [p.subject_id, p]));
                  return (
                    <TableRow key={stu.student_id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(stu.student_id)}
                          onCheckedChange={(c) => toggleOne(stu.student_id, c as boolean)}
                        />
                      </TableCell>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-medium">{stu.student_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{stu.student_class}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {getRollNoDisplay(stu) || '—'}
                      </TableCell>
                      {orderedSubjects.map((s) => (
                        <TableCell key={`c-sub-${s.id}`} className="text-center">
                          {bySubject.has(s.id) ? <Check className="mx-auto h-4 w-4 text-primary" /> : ''}
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Edit subjects"
                          onClick={() => setEditingStudent(stu)}
                          disabled={stu.participations.length === 0}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected students?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {selectedIds.size} student{selectedIds.size === 1 ? '' : 's'} and all their subject
              registrations from this school. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editRegistration && (
        <EditStudentRegistrationDialog
          open={!!editingStudent}
          onOpenChange={(open) => {
            if (!open) setEditingStudent(null);
          }}
          registration={editRegistration}
        />
      )}
    </Card>
  );
};
