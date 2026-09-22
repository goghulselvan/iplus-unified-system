import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Lock } from 'lucide-react';
import { ManualStudentRegistration } from './ManualStudentRegistration';
import { BulkStudentRegistration } from './BulkStudentRegistration';
import { SchoolStudentsTable } from './SchoolStudentsTable';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useStudentRegistrations } from '@/hooks/useStudentRegistrations';
import { useDeleteStudentRegistrations } from '@/hooks/useDeleteStudentRegistrations';
import { supabase } from '@/integrations/supabase/client';

interface StudentRegistrationFormProps {
  schoolId: string;
  schoolName: string;
  schoolSSNo: number;
}

const StudentRegistrationForm = ({ schoolId, schoolName }: StudentRegistrationFormProps) => {
  const { data: activeProject } = useActiveProject();
  const { data: registrations, refetch } = useStudentRegistrations(activeProject?.id, { schoolId });
  const deleteRegistrations = useDeleteStudentRegistrations();

  // Same key/shape as PortalRegistrationView.tsx's workflow query — React
  // Query dedupes automatically when both are mounted, no extra network call.
  const { data: workflow, isLoading: workflowLoading } = useQuery({
    queryKey: ['crm-portal-workflow', schoolId, activeProject?.id],
    enabled: !!activeProject?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_project_workflow')
        .select('payment_received')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const hasPayment = !workflowLoading && ((workflow as { payment_received?: number } | null)?.payment_received ?? 0) > 0;

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
          {hasPayment ? (
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
          ) : (
            <div className="py-8 text-center">
              <Lock className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-foreground mb-1">Payment Required Before Adding Students</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Record a payment on the Payment tab first — Manual Registration and Bulk Upload unlock once at
                least one payment is on record for this school.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student-centric Registered Students Table */}
      <SchoolStudentsTable schoolId={schoolId} schoolName={schoolName} />
    </div>
  );
};

export default StudentRegistrationForm;
