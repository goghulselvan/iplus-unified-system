import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import { useAuth } from '@/hooks/useAuth';
import { useActiveProject, useOlympiadSubjects } from '@/hooks/useOlympiadProjects';
import ReportBuilder from '@/components/export/ReportBuilder';
import { FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

const ExportModule = () => {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const { data: activeProject, isLoading: projectLoading } = useActiveProject();
  const { data: subjects = [], isLoading: subjectsLoading } = useOlympiadSubjects(activeProject?.id);

  // Redirect non-superadmins
  useEffect(() => {
    if (!authLoading && profile?.role !== 'superadmin') {
      navigate('/dashboard');
    }
  }, [authLoading, profile, navigate]);

  // Show nothing while checking auth
  if (authLoading) {
    return null;
  }

  // Double-check superadmin access
  if (profile?.role !== 'superadmin') {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>
              You do not have permission to access the Advanced Export Module. 
              This feature is restricted to superadmin users only.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const isLoading = projectLoading || subjectsLoading;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Advanced Export Module</h1>
              <p className="text-muted-foreground">
                Create custom reports and export data to CSV
              </p>
            </div>
          </div>
        </div>

        {!activeProject && !projectLoading && (
          <Alert className="mb-6">
            <AlertTitle>No Active Project</AlertTitle>
            <AlertDescription>
              Please select an active project from the Projects page to generate reports.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-96" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            </CardContent>
          </Card>
        ) : activeProject ? (
          <ReportBuilder projectId={activeProject.id} subjects={subjects} />
        ) : null}
      </main>
    </div>
  );
};

export default ExportModule;
