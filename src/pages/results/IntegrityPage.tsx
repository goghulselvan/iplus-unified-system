import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { useClasses } from "@/hooks/results/usePapers";
import {
  useFlagDetail, useIntegrityFlags, useReviewFlag, useRunScan,
  type FlagStatus, type IntegrityFlag, type ScanSummary,
} from "@/hooks/results/usePhase47";
import { FLAG_TYPE_LABEL, NOTE_REQUIRED, SEVERITY_LABEL, STATUS_LABEL, flagExplanation } from "@/lib/results/integrityText";
import { formatReg } from "@/lib/results/regNumber";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SEV_CLASS: Record<string, string> = {
  critical: "bg-red-700 text-white hover:bg-red-700",
  high: "bg-amber-700 text-white hover:bg-amber-700",
  medium: "bg-slate-600 text-white hover:bg-slate-600",
};
const STATUS_ORDER: FlagStatus[] = ["pending", "investigating", "verified", "dismissed"];

export default function IntegrityPage() {
  const { data: project, isLoading: loadingProject } = useResultsProject();
  const { data: classes } = useClasses();
  const { data, isLoading, isError } = useIntegrityFlags(project?.id);
  const scan = useRunScan(project?.id);
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [confirmScan, setConfirmScan] = useState(false);
  const [open, setOpen] = useState<IntegrityFlag | null>(null);
  const [severity, setSeverity] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [school, setSchool] = useState("");

  useEffect(() => () => clearInterval(timer.current), []);

  const className = (code: string) => classes?.find((c) => c.code === code)?.display_name ?? `Class ${code}`;
  const schoolName = (id: string) => data?.schools.get(id)?.name ?? "this school";

  const flags = useMemo(
    () => (data?.flags ?? []).filter((f) =>
      (!severity || f.severity === severity) && (!type || f.flag_type === type) &&
      (!status || f.status === status) && (!school || f.school_id === school)),
    [data, severity, type, status, school],
  );
  const schoolOptions = useMemo(
    () => [...new Set((data?.flags ?? []).map((f) => f.school_id))]
      .map((id) => ({ id, name: data?.schools.get(id)?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const runScan = () => {
    setConfirmScan(false);
    setSummary(null);
    setPct(2);
    // The check runs in one step on the server, so the bar is an estimate that holds at 95% until it finishes.
    timer.current = setInterval(() => setPct((p) => (p < 95 ? p + Math.max(1, (95 - p) / 12) : p)), 600);
    scan.mutate(undefined, {
      onSuccess: (s) => { setSummary(s); toast.success(`Check finished: ${s.flags} new ${s.flags === 1 ? "flag" : "flags"} found.`); },
      onError: (e) => toast.error(e.message),
      onSettled: () => { clearInterval(timer.current); setPct(100); },
    });
  };

  if (loadingProject) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 py-5">
          <p className="text-base">
            The check looks for answer patterns that are unlikely to happen by chance. A flag is only a reason to look closer.
            Nothing changes for any student or school because of a flag; you decide what it means.
          </p>
          <Button onClick={() => setConfirmScan(true)} disabled={scan.isPending} className="min-h-11">
            <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" /> Run the check
          </Button>
          {(scan.isPending || (scan.isSuccess && pct === 100 && summary)) && (
            <ProgressPanel stage={scan.isPending ? "Checking every school's answers" : "Check finished"} percent={pct}
              detail={scan.isPending ? "This can take a minute or two. Please keep this page open." : undefined} />
          )}
          {summary && (
            <p className="text-base" role="status">
              Looked at {summary.groupsScanned} school and paper groups. {summary.flags} new {summary.flags === 1 ? "flag" : "flags"}
              {" "}({summary.bySeverity.critical} critical, {summary.bySeverity.high} high, {summary.bySeverity.medium} medium).
              {summary.keptReviewed > 0 && ` ${summary.keptReviewed} flags you already reviewed were kept${summary.alreadyReviewed ? `, and ${summary.alreadyReviewed} repeats were not raised again` : ""}.`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="f-sev" className="text-sm">How serious</Label>
          <select id="f-sev" className={selectClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>{Object.entries(SEVERITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><Label htmlFor="f-type" className="text-sm">Kind of pattern</Label>
          <select id="f-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>{Object.entries(FLAG_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><Label htmlFor="f-status" className="text-sm">Review status</Label>
          <select id="f-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select></div>
        <div><Label htmlFor="f-school" className="text-sm">School</Label>
          <select id="f-school" className={selectClass} value={school} onChange={(e) => setSchool(e.target.value)}>
            <option value="">All schools</option>{schoolOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      </div>

      {isLoading ? <Skeleton className="h-40 w-full" /> : isError ? (
        <Card><CardContent className="py-8 text-base">We could not load the flags. Please refresh the page.</CardContent></Card>
      ) : flags.length === 0 ? (
        <Card><CardContent className="py-8 text-base">
          {(data?.flags.length ?? 0) === 0 ? "No flags yet. Run the check to look for suspicious patterns." : "No flags match these filters."}
        </CardContent></Card>
      ) : (
        <ul className="space-y-3" aria-label="Flags">
          <li className="text-sm text-muted-foreground">{flags.length} {flags.length === 1 ? "flag" : "flags"}</li>
          {flags.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={SEV_CLASS[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
                      <span className="text-sm font-medium">{FLAG_TYPE_LABEL[f.flag_type]}</span>
                      <Badge variant="outline" className="text-sm">{STATUS_LABEL[f.status]}</Badge>
                    </div>
                    <p className="text-base font-medium">{schoolName(f.school_id)}</p>
                    <p className="text-base">{flagExplanation(f, schoolName(f.school_id), className)}</p>
                    {f.notes && <p className="text-sm text-muted-foreground">Note: {f.notes}</p>}
                  </div>
                  <Button variant="outline" className="min-h-11 shrink-0" onClick={() => setOpen(f)}>Look closer</Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirmScan} onOpenChange={setConfirmScan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the check now?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks at every evaluated student. Flags nobody has reviewed yet are replaced by the new results.
              Flags you have marked Investigating, Verified or Dismissed are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Not now</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={runScan}>Run the check</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open && <FlagDrawer key={open.id} flag={open} projectId={project.id} schoolName={schoolName(open.school_id)} className={className} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FlagDrawer({ flag, projectId, schoolName, className, onClose }: {
  flag: IntegrityFlag; projectId: string; schoolName: string; className: (c: string) => string; onClose: () => void;
}) {
  const { data, isLoading, isError } = useFlagDetail(flag.details.enrollmentIds, true);
  const review = useReviewFlag(projectId);
  const [status, setStatus] = useState<FlagStatus>(flag.status);
  const [notes, setNotes] = useState(flag.notes ?? "");
  const needsNote = NOTE_REQUIRED.has(status) && !notes.trim();
  const total = flag.details.enrollmentIds?.length ?? 0;

  const save = () =>
    review.mutate({ flagId: flag.id, status, notes }, {
      onSuccess: () => { toast.success(`Marked ${STATUS_LABEL[status]}.`); onClose(); },
      onError: (e) => toast.error(e.message),
    });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{FLAG_TYPE_LABEL[flag.flag_type]}</SheetTitle>
          <SheetDescription className="text-base">{flagExplanation(flag, schoolName, className)}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-3">
          <h3 className="text-base font-semibold">Students involved ({total})</h3>
          {isLoading ? <Skeleton className="h-32 w-full" /> : isError ? (
            <p className="text-base">We could not load the students. Please close this and try again.</p>
          ) : (
            <ul className="space-y-3">
              {data?.students.map((s) => (
                <li key={s.enrollmentId} className="rounded-md border p-3">
                  <p className="text-base font-medium">{s.name}</p>
                  <p className="text-sm text-muted-foreground">{formatReg(s.regNumber)}</p>
                  {!s.answers && <p className="mt-1 text-sm text-muted-foreground">No answer sheet (marked by hand, so only scores are compared).</p>}
                </li>
              ))}
              {total > (data?.students.length ?? 0) && <li className="text-sm text-muted-foreground">Showing the first {data?.students.length} of {total} students.</li>}
            </ul>
          )}
          {data && data.students.some((s) => s.answers) && <SideBySide students={data.students} keyMap={data.key} />}
          {data && data.students.some((s) => s.answers) && (
            <p className="text-sm text-muted-foreground">
              Shaded columns are questions every student answered the same way.
              {Object.keys(data.key).length > 0 ? " Answers in red are wrong against the answer key." : " The answer key is not shown because these students sat different papers."} A dash means not answered.
            </p>
          )}
        </div>

        <div className="mt-6 space-y-3 border-t pt-5">
          <h3 className="text-base font-semibold">Your review</h3>
          <div>
            <Label htmlFor="flag-status" className="text-sm">Status</Label>
            <select id="flag-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as FlagStatus)}>
              {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="flag-note" className="text-sm">Note{NOTE_REQUIRED.has(status) ? " (required)" : ""}</Label>
            <Textarea id="flag-note" className="text-base" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you find, and why did you decide this?" />
          </div>
          {status === "verified" && (
            <p className="text-sm">Verified means the pattern is real. This school's students will be left out of automatic awards and listed for manual handling. Nothing else changes.</p>
          )}
          <div className="flex gap-3">
            <Button className="min-h-11" onClick={save} disabled={needsNote || review.isPending}>Save review</Button>
            <Button className="min-h-11" variant="outline" onClick={onClose}>Close</Button>
          </div>
          {needsNote && <p className="text-sm text-red-700" role="alert">Please add a note before choosing {STATUS_LABEL[status]}.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SideBySide({ students, keyMap }: { students: { enrollmentId: string; name: string; regNumber: string; answers: string[] | null }[]; keyMap: Record<number, string> }) {
  const withAnswers = students.filter((s) => s.answers);
  const len = Math.max(0, ...withAnswers.map((s) => s.answers!.length));
  // Questions where every listed student gave the same answer are shaded.
  const same = Array.from({ length: len }, (_, i) => withAnswers.length > 1 && !!withAnswers[0].answers![i] && withAnswers.every((s) => s.answers![i] === withAnswers[0].answers![i]));
  return (
    <div className="overflow-x-auto rounded-md border p-3" aria-label="Answers side by side">
      <table className="font-mono text-base">
        <tbody>
          <tr>
            <th scope="row" className="pr-3 text-left font-sans text-sm font-normal text-muted-foreground">Question</th>
            {Array.from({ length: len }, (_, i) => <td key={i} className={`px-0.5 text-center text-xs text-muted-foreground ${i % 10 === 9 ? "pr-2" : ""}`}>{i + 1}</td>)}
          </tr>
          {withAnswers.map((s) => (
            <tr key={s.enrollmentId}>
              <th scope="row" className="whitespace-nowrap pr-3 text-left font-sans text-sm font-medium">{s.name}</th>
              {Array.from({ length: len }, (_, i) => {
                const a = s.answers![i];
                const wrong = a && keyMap[i + 1] && keyMap[i + 1] !== a;
                return <td key={i} className={`px-0.5 text-center ${same[i] ? "bg-muted" : ""} ${wrong ? "font-bold text-red-700" : ""} ${i % 10 === 9 ? "pr-2" : ""}`}>{a || "-"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
