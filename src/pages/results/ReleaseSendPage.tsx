import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { NOT_SUPERADMIN, useIsSuperadmin } from "@/hooks/results/useRelease";
import { ReleaseTab } from "@/components/results/release/ReleaseTab";
import { SendTab } from "@/components/results/release/SendTab";

export default function ReleaseSendPage() {
  const { isSuperadmin, loading } = useIsSuperadmin();
  const { data: project, isLoading } = useResultsProject();
  if (loading) return <Skeleton className="h-64 w-full" />;
  // Managers get a plain message and no controls. Every database call and the send function re-check the role.
  if (!isSuperadmin) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-10">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-base">{NOT_SUPERADMIN}</p>
      </CardContent></Card>
    );
  }
  if (isLoading || !project) return <Skeleton className="h-64 w-full" />;
  return (
    <Tabs defaultValue="release" className="space-y-6">
      <TabsList>
        <TabsTrigger value="release" className="min-h-11 text-base">Release</TabsTrigger>
        <TabsTrigger value="send" className="min-h-11 text-base">Send</TabsTrigger>
      </TabsList>
      <TabsContent value="release"><ReleaseTab projectId={project.id} /></TabsContent>
      <TabsContent value="send"><SendTab projectId={project.id} /></TabsContent>
    </Tabs>
  );
}
