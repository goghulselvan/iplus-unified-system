import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import {
  skillsFor, useClasses, useCopyPaperFromSlot, usePaper, usePapers, useSaveAnswerKey, useSaveQuestions,
  useSetPaperStatus, useSkillLists, revertIfNoLongerReady, useSlotTemplates,
} from "@/hooks/results/usePapers";
import { OLYMPIAD_NAMES, classGroup, type OlympiadCode } from "@/lib/results/paperRules";
import { PaperGrid, type CreateDefaults } from "@/components/results/papers/PaperGrid";
import { CreatePaperDialog } from "@/components/results/papers/CreatePaperDialog";
import PaperEditor from "@/components/results/papers/PaperEditor";

const Message = ({ children }: { children: React.ReactNode }) => (
  <Card><CardContent className="py-10 text-base">{children}</CardContent></Card>
);

export function PaperEditorRoute() {
  const { paperId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: project } = useActiveProject();
  const { data, isLoading, isError } = usePaper(paperId);
  const { data: classes } = useClasses();
  const { data: slots } = useSlotTemplates(data?.paper.project_id);
  const { data: allPapers } = usePapers(data?.paper.project_id);
  const { data: skillLists } = useSkillLists();
  const projectId = data?.paper.project_id ?? project?.id;
  const save = useSaveQuestions(paperId!, projectId);
  const saveKeyMut = useSaveAnswerKey(paperId!, projectId);
  const setStatus = useSetPaperStatus(projectId);

  const paper = data?.paper;
  const slotIndex = slots?.findIndex((s) => s.id === paper?.slot_template_id) ?? -1;
  const firstSlot = slots?.[0];
  const source = paper && firstSlot && slotIndex > 0
    ? allPapers?.find((p) => p.slot_template_id === firstSlot.id && p.class_code === paper.class_code && p.olympiad_code === paper.olympiad_code)
    : undefined;
  const copy = useCopyPaperFromSlot(source?.id ?? "", paperId!, { replace: false }, projectId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Message>We could not open this paper. Please refresh and try again.</Message>;
  if (!data || !paper) return <Message>This paper could not be found. It may have been removed.</Message>;

  const cls = classes?.find((c) => c.code === paper.class_code);
  const name = `${cls?.display_name ?? paper.class_code} · ${OLYMPIAD_NAMES[paper.olympiad_code as OlympiadCode]} · Slot ${Math.max(slotIndex, 0) + 1}`;

  return (
    <PaperEditor
      paper={paper}
      paperName={name}
      questions={data.questions}
      skills={skillsFor(skillLists, paper.olympiad_code, classGroup(paper.class_code))}
      copySource={slotIndex > 0 ? { label: "Slot 1", unavailable: !source ? "Slot 1 has no paper for this class and subject yet." : source.entered === 0 ? "Slot 1 has no questions yet. Set up the Slot 1 paper first, then copy it here." : undefined } : undefined}
      onBack={() => navigate("/results/papers")}
      onSave={async (rows) => { await save.mutateAsync(rows); }}
      onSaveKey={async (rows) => { await saveKeyMut.mutateAsync(rows); }}
      onSetStatus={async (status) => { await setStatus.mutateAsync({ paperId: paper.id, status }); }}
      onCopy={async (replace) => { await copy.mutateAsync({ replace }); }}
      onChanged={async () => {
        await revertIfNoLongerReady(paper.id);
        qc.invalidateQueries({ queryKey: ["results", "paper", paper.id] });
        qc.invalidateQueries({ queryKey: ["results", "papers"] });
      }}
    />
  );
}

export default function QuestionPapersPage() {
  const navigate = useNavigate();
  const { data: project, isLoading: loadingProject } = useActiveProject();
  const { data: papers, isLoading, isError } = usePapers(project?.id);
  const { data: classes } = useClasses();
  const { data: slots } = useSlotTemplates(project?.id);
  const [creating, setCreating] = useState<CreateDefaults | null>(null);

  if (loadingProject || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Message>There is no active olympiad year right now, so there are no papers to show.</Message>;
  if (isError) return <Message>We could not load the question papers. Please refresh and try again.</Message>;
  if (!slots?.length) return <Message>No exam slots are set up for {project.project_name} yet. Add the exam slots first, then come back here.</Message>;

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">
        Pick a paper to open it. Choose a dashed box to create a paper that does not exist yet.
      </p>
      <PaperGrid
        papers={papers ?? []}
        classes={classes ?? []}
        slots={slots}
        onOpen={(p) => navigate(`/results/papers/${p.id}`)}
        onCreate={setCreating}
      />
      <CreatePaperDialog
        open={!!creating}
        onOpenChange={(o) => !o && setCreating(null)}
        projectId={project.id}
        classes={classes ?? []}
        slots={slots}
        defaults={creating ?? undefined}
        onCreated={(p) => { setCreating(null); navigate(`/results/papers/${p.id}`); }}
      />
    </div>
  );
}
