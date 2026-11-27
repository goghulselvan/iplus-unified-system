import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { OmrUploadChecker } from "@/components/results/upload/OmrUploadChecker";

const Message = ({ children }: { children: React.ReactNode }) => (
  <Card><CardContent className="py-10 text-base">{children}</CardContent></Card>
);

export default function UploadAnswersPage() {
  const { data: project, isLoading: loadingProject } = useResultsProject();
  const [tab, setTab] = useState<"manual" | "omr">("manual");
  const [busy, setBusy] = useState(false);

  if (loadingProject) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Message>There is no active olympiad year right now.</Message>;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "omr")}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="manual" disabled={busy} className="min-h-11 text-sm">Manual marks (LKG – Class 2)</TabsTrigger>
        <TabsTrigger value="omr" disabled={busy} className="min-h-11 text-sm">OMR answers (Class 3 and above)</TabsTrigger>
      </TabsList>
      <TabsContent value="manual" className="mt-4">
        <div className="space-y-5">
          <div className="space-y-1 text-base text-muted-foreground">
            <p>For LKG to Class 2, marked by hand. Upload the marking sheet (.xlsx, every sheet is read) or a .csv. Each sheet can be either:</p>
            <ul className="list-disc pl-6">
              <li>marks per question: Reg No, Name, Q1, Q2, … with 0, 0.5 or 1 (a blank counts as 0; the system adds up the total), or</li>
              <li>totals only: Reg No, Name, Total (0 up to the number of questions, in steps of 0.5).</li>
            </ul>
            <p>A row with no marks is skipped and the student stays Pending.</p>
          </div>
          <OmrUploadChecker projectId={project.id} mode="manual" onBusyChange={setBusy} />
        </div>
      </TabsContent>
      <TabsContent value="omr" className="mt-4">
        <div className="space-y-5">
          <p className="text-base text-muted-foreground">
            For Class 3 and above. Upload the OMR machine's file as it is: any mix of subjects, classes and schools.
            Each student's paper is found from their roll number and their school's exam slot. MULTIPLE counts as wrong, a blank as unanswered.
          </p>
          <OmrUploadChecker projectId={project.id} onBusyChange={setBusy} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
