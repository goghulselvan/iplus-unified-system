import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import BulkImportExport from "@/components/bulk/BulkImportExport";
import ReportBuilder from "@/components/export/ReportBuilder";
import { useAuth } from "@/hooks/useAuth";
import { useActiveProject, useOlympiadSubjects } from "@/hooks/useOlympiadProjects";

export default function DataManagement() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const { data: activeProject, isLoading: projectLoading } = useActiveProject();
  const { data: subjects = [], isLoading: subjectsLoading } = useOlympiadSubjects(activeProject?.id);

  useEffect(() => {
    if (!authLoading && profile?.role !== "superadmin") {
      navigate("/dashboard");
    }
  }, [authLoading, profile, navigate]);

  if (authLoading) return null;

  if (profile?.role !== "superadmin") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>Data Management is restricted to superadmin users only.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const isLoading = projectLoading || subjectsLoading;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Data Management</h1>
          <p className="text-muted-foreground mt-1">
            Import school data in bulk, export reports, and generate advanced custom exports
          </p>
        </div>

        {!activeProject && !projectLoading && (
          <Alert className="mb-6">
            <AlertTitle>No Active Project</AlertTitle>
            <AlertDescription>
              Please set an active project from the Projects page to use export features.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="import-export" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="import-export" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Bulk Import / Export
            </TabsTrigger>
            <TabsTrigger value="advanced-export" className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Advanced Export
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import-export">
            <div className="max-w-4xl">
              <BulkImportExport />
            </div>
          </TabsContent>

          <TabsContent value="advanced-export">
            {isLoading ? (
              <Card>
                <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            ) : activeProject ? (
              <ReportBuilder projectId={activeProject.id} subjects={subjects} />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
