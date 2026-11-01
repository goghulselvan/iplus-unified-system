import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useClasses, usePapers, useSlotTemplates } from "@/hooks/results/usePapers";
import { PaperPicker, paperLabel } from "@/components/results/upload/PaperPicker";
import { UploadChecker } from "@/components/results/upload/UploadChecker";

const Message = ({ children }: { children: React.ReactNode }) => (
  <Card><CardContent className="py-10 text-base">{children}</CardContent></Card>
);

export default function UploadAnswersPage() {
  const { data: project, isLoading: loadingProject } = useActiveProject();
  const { data: papers, isLoading, isError } = usePapers(project?.id);
  const { data: classes } = useClasses();
  const { data: slots } = useSlotTemplates(project?.id);
  const [tab, setTab] = useState<"manual" | "omr">("manual");
  const [picked, setPicked] = useState<Record<string, string>>({ manual: "", omr: "" });

  if (loadingProject || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Message>There is no active olympiad year right now.</Message>;
  if (isError) return <Message>We could not load the question papers. Please refresh and try again.</Message>;

  const all = papers ?? [];
  const cls = classes ?? [];
  const sl = slots ?? [];

  const panel = (kind: "manual" | "omr") => {
    const paper = all.find((p) => p.id === picked[kind]);
    return (
      <div className="space-y-5">
        <p className="text-base text-muted-foreground">
          {kind === "manual"
            ? "For LKG to Class 2. Teachers mark each question 0, 0.5 or 1 and the marks are typed into a CSV file."
            : "For Class 3 to Class 8. The OMR operator's file gives each answer as A, B, C or D. A blank means not answered."}
        </p>
        <PaperPicker kind={kind} papers={all} classes={cls} slots={sl} value={picked[kind]}
          onChange={(id) => setPicked((s) => ({ ...s, [kind]: id }))} />
        {paper && <UploadChecker paper={paper} kind={kind} label={paperLabel(paper, cls, sl)} />}
      </div>
    );
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "manual" | "omr")}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="manual" className="min-h-11 text-sm">Manual marks (LKG – Class 2)</TabsTrigger>
        <TabsTrigger value="omr" className="min-h-11 text-sm">OMR answers (Class 3 – 8)</TabsTrigger>
      </TabsList>
      <TabsContent value="manual" className="mt-4">{panel("manual")}</TabsContent>
      <TabsContent value="omr" className="mt-4">{panel("omr")}</TabsContent>
    </Tabs>
  );
}
