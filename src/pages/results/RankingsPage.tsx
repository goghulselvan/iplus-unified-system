import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { RankingsTab } from "@/components/results/rankings/RankingsTab";
import { CoverageTab } from "@/components/results/rankings/CoverageTab";

export default function RankingsPage() {
  const { data: project, isLoading } = useResultsProject();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project)
    return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now, so there are no rankings to show.</CardContent></Card>;
  return (
    <Tabs defaultValue="ranks" className="space-y-4">
      <TabsList>
        <TabsTrigger value="ranks" className="min-h-10 text-sm">Rankings</TabsTrigger>
        <TabsTrigger value="coverage" className="min-h-10 text-sm">Registered vs Evaluated</TabsTrigger>
      </TabsList>
      <TabsContent value="ranks"><RankingsTab projectId={project.id} /></TabsContent>
      <TabsContent value="coverage"><CoverageTab projectId={project.id} /></TabsContent>
    </Tabs>
  );
}
