import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import {
  skillsFor, useClasses, useCopyPaperFromSlot, usePaper, usePapers, useSaveAnswerKey, useSaveQuestions,
  useSetPaperStatus, useSkillLists, revertIfNoLongerReady, useSlotTemplates,
} from "@/hooks/results/usePapers";
import { OLYMPIAD_NAMES, classGroup, type OlympiadCode } from "@/lib/results/paperRules";
import { PaperGrid, type CreateDefaults } from "@/components/results/papers/PaperGrid";
import { CopySlotPapersButton } from "@/components/results/papers/CopySlotPapersButton";
import { LinkedPaperNotice } from "@/components/results/papers/LinkedPaperNotice";
import { CreatePaperDialog } from "@/components/results/papers/CreatePaperDialog";
import PaperEditor from "@/components/results/papers/PaperEditor";
import { otherProjectNotice } from "@/lib/results/projectScope";

const Message = ({ children }: { children: React.ReactNode }) => (
  <Card><CardContent className="py-10 text-base">{children}</CardContent></Card>
);

export function PaperEditorRoute() {
  const { paperId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: project } = useResultsProject();
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

  const notice = otherProjectNotice(project?.id, paper.project_id, null, "paper");
  // linked_from_paper_id is newer than the generated types.
  const linkedFrom = (paper as typeof paper & { linked_from_paper_id?: string | null }).linked_from_paper_id ?? null;
  const linkedSource = linkedFrom ? allPapers?.find((p) => p.id === linkedFrom) : undefined;
  const linkedSlot = linkedSource ? slots?.find((s) => s.id === linkedSource.slot_template_id)?.slot_name ?? "other slot" : "other slot";

  return (
    <>
    {notice && <p role="status" className="mb-4 rounded-md border border-amber-600 bg-amber-50 p-3 text-base text-amber-950">{notice}</p>}
    {linkedFrom && (
      <div className="mb-4">
        <LinkedPaperNotice paperId={paper.id} sourceName={linkedSlot}
          onChanged={() => qc.invalidateQueries({ queryKey: ["results"] })} />
      </div>
    )}
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
    </>
  );
}

export default function QuestionPapersPage() {
  const navigate = useNavigate();
  const { data: project, isLoading: loadingProject } = useResultsProject();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-muted-foreground">
          Pick a paper to open it. Choose a dashed box to create a paper that does not exist yet.
        </p>
        <CopySlotPapersButton projectId={project.id} slots={slots} />
      </div>
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
