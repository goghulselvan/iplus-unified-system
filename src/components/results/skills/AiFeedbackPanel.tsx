import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { supabase } from "@/integrations/supabase/client";
import { collectBatch, submitFeedback, useAiBatches, type AiBatchRow } from "@/hooks/results/useSkills";
import { feedbackStage, jobsNeedingRetry, percentOf, retryLabel, summariseBatches } from "@/lib/results/skillProgress";

function useStudentNames(ids: string[]) {
  const key = ids.slice(0, 20).join(",");
  return useQuery({
    queryKey: ["results", "student-names", key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("portal_student_enrollments")
        .select("id, portal_registered_students(student_name)").in("id", ids.slice(0, 20));
      return ((data ?? []) as unknown as { id: string; portal_registered_students: { student_name: string } | null }[])
        .map((r) => r.portal_registered_students?.student_name ?? "A student");
    },
  });
}

export function ErrorList({ job, ids, onRetry, busy }: { job: AiBatchRow; ids: string[]; onRetry: () => void; busy: boolean }) {
  const { data: names } = useStudentNames(ids);
  return (
    <Alert variant="destructive" className="border-amber-600 bg-amber-50 text-amber-950 [&>svg]:text-amber-950">
      <AlertTitle className="text-base">Claude could not write feedback for {job.errored} {job.errored === 1 ? "student" : "students"}</AlertTitle>
      <AlertDescription className="space-y-3 text-base">
        {names && names.length > 0 && (
          <p className="text-sm">{names.join(", ")}{job.errored > names.length ? ` and ${job.errored - names.length} more` : ""}</p>
        )}
        <Button type="button" className="min-h-11" disabled={busy} onClick={onRetry}>{retryLabel(job.errored)}</Button>
      </AlertDescription>
    </Alert>
  );
}

/** "Write feedback for all schools" with live progress, saving and the retry list. */
export function AiFeedbackPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: batches, isError } = useAiBatches(projectId);
  const [confirm, setConfirm] = useState(false);
  const [failedIds, setFailedIds] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const rows = batches ?? [];
  const sum = summariseBatches(rows);
  const refresh = () => qc.invalidateQueries({ queryKey: ["results", "ai-batches", projectId] });

  const submit = useMutation({
    mutationFn: (schoolId: string | null) => submitFeedback(projectId, schoolId),
    onSuccess: (r) => {
      if (r.total === 0) toast.message(r.message ?? "Everyone already has up-to-date feedback.");
      else toast.success(`Claude has started writing feedback for ${r.total.toLocaleString("en-IN")} students.`);
      if (r.warning) toast.warning(r.warning);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ended = rows.filter((b) => b.status === "ended");
  const endedKey = ended.map((b) => b.id).join(",");
  useEffect(() => {
    const todo = ended.filter((b) => !inFlight.current.has(b.id));
    if (todo.length === 0) return;
    setSaveError(null);
    setSaving((s) => ({ done: s?.done ?? 0, total: (s?.total ?? 0) + todo.length }));
    todo.forEach((b) => {
      inFlight.current.add(b.id);
      collectBatch(b.id)
        .then((r) => { setFailedIds((f) => ({ ...f, [b.id]: r.failedEnrollmentIds })); })
        .catch((e: Error) => { inFlight.current.delete(b.id); setSaveError(e.message); })
        .finally(() => {
          setSaving((s) => (s ? { ...s, done: s.done + 1 } : s));
          void refresh();
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedKey]);
  useEffect(() => { if (saving && saving.done >= saving.total && ended.length === 0) setSaving(null); }, [saving, ended.length]);

  const retries = jobsNeedingRetry(rows);
  const working = sum.running || sum.waitingToCollect || submit.isPending || !!saving;

  return (
    <section aria-labelledby="ai-all-h" className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="ai-all-h" className="text-lg font-semibold">AI feedback for students</h3>
          <p className="text-sm text-muted-foreground">Claude writes a short note for each student from their scores and skills. Names are never sent. It can take a while, and you can leave this page and come back.</p>
        </div>
        <Button type="button" className="min-h-11" disabled={working} onClick={() => setConfirm(true)}>
          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />Generate AI feedback for all schools
        </Button>
      </div>

      {isError && <p className="text-base text-red-800">We could not check on the feedback jobs. Please refresh.</p>}

      {sum.running && (
        <ProgressPanel stage={feedbackStage(sum.done, sum.total)} percent={sum.percent} detail="We check again every 20 seconds while this page is open." />
      )}
      {saving && (
        <ProgressPanel
          stage={`Saving the feedback: part ${Math.min(saving.done + 1, saving.total)} of ${saving.total}`}
          percent={percentOf(saving.done, saving.total)}
        />
      )}
      {saveError && (
        <Alert variant="destructive"><AlertTitle>The feedback could not be saved yet</AlertTitle>
          <AlertDescription className="space-y-2 text-base"><p>{saveError}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setSaveError(null); void refresh(); }}>Try saving again</Button>
          </AlertDescription>
        </Alert>
      )}

      {retries.map((job) => (
        <ErrorList key={job.id} job={job} busy={working} ids={failedIds[job.id] ?? job.errored_enrollment_ids ?? []} onRetry={() => submit.mutate(job.school_id)} />
      ))}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write feedback for all schools?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Claude will write feedback for every evaluated student who does not have up-to-date feedback yet. Only class, olympiad, grade and skill scores are sent, never names. Students who already have fresh feedback are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => submit.mutate(null)}>Start writing</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** One school: write student feedback just for that school. */
export function SchoolFeedbackButton({ projectId, schoolId }: { projectId: string; schoolId: string }) {
  const qc = useQueryClient();
  const { data: batches } = useAiBatches(projectId);
  const open = (batches ?? []).some((b) => (b.status === "submitted" || b.status === "ended") && (b.school_id === schoolId || b.school_id === null));
  const m = useMutation({
    mutationFn: () => submitFeedback(projectId, schoolId),
    onSuccess: (r) => {
      toast.success(r.total === 0 ? (r.message ?? "Everyone here already has up-to-date feedback.") : `Claude has started writing feedback for ${r.total.toLocaleString("en-IN")} students.`);
      void qc.invalidateQueries({ queryKey: ["results", "ai-batches", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button type="button" variant="outline" className="min-h-11" disabled={m.isPending || open} onClick={() => m.mutate()}>
      <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{open ? "Feedback is being written" : "Write student feedback for this school"}
    </Button>
  );
}
