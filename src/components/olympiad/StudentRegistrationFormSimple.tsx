import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ManualStudentRegistration } from './ManualStudentRegistration';
import { BulkStudentRegistration } from './BulkStudentRegistration';
import { SchoolStudentsTable } from './SchoolStudentsTable';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useStudentRegistrations } from '@/hooks/useStudentRegistrations';
import { useDeleteStudentRegistrations } from '@/hooks/useDeleteStudentRegistrations';

interface StudentRegistrationFormProps {
  schoolId: string;
  schoolName: string;
  schoolSSNo: number;
}

const StudentRegistrationForm = ({ schoolId, schoolName }: StudentRegistrationFormProps) => {
  const { data: activeProject } = useActiveProject();
  const { data: registrations, refetch } = useStudentRegistrations(activeProject?.id, { schoolId });
  const deleteRegistrations = useDeleteStudentRegistrations();

  const refreshData = () => {
    refetch();
  };

  const handleDeleteRegistrations = async (ids: string[]) => {
    await deleteRegistrations.mutateAsync({
      schoolId,
      specificStudentIds: ids,
    });
  };

  if (!activeProject) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No active project found. Please create or activate a project first.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Student Registrations</CardTitle>
          <CardDescription>
            Manage student registrations for {schoolName} with auto-generated registration numbers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="manual" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual Registration</TabsTrigger>
              <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
            </TabsList>
            
            <TabsContent value="manual">
              <ManualStudentRegistration 
                schoolId={schoolId} 
                onSuccess={refreshData}
              />
            </TabsContent>
            
            <TabsContent value="bulk">
              <BulkStudentRegistration 
                schoolId={schoolId} 
                onSuccess={refreshData}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Student-centric Registered Students Table */}
      <SchoolStudentsTable schoolId={schoolId} schoolName={schoolName} />
    </div>
  );
};

export default StudentRegistrationForm;
