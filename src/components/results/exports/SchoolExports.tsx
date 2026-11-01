import { useEffect, useRef, useState } from "react";
import { Download, FileText, Archive, ListOrdered } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import type { ClassOlympiadRow, RankRow, SchoolSummaryRow } from "@/hooks/results/useResultsReads";
import { fetchFeedback, fetchSchoolAnalysis } from "@/hooks/results/useSkills";
import { generateSchoolRanking, generateSchoolSummary, lossyText } from "@/lib/results/pdf";
import { fetchSchoolRankRows, fileSafe, olympiadName } from "@/lib/results/pdfData";
import { scoreSheetJob, skillReportJob, type MakeWrap, type SchoolZipContext, type ZipJob } from "@/lib/results/schoolZipInputs";
import { streamZipParts, zipPartName } from "@/lib/results/zipParts";
import { downloadBlob } from "@/lib/results/downloadBlob";
import { exportStage, percentOf } from "@/lib/results/skillProgress";
import { schoolGrade } from "@/lib/results/grading";
import { formatReg } from "@/lib/results/regNumber";

type Kind = "ranking" | "scoreZip" | "skillZip";
interface Pending { kind: Kind; rows: RankRow[]; lossy: string[]; outdated: number }
class Cancelled extends Error {}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));
const num = (v: unknown) => Number(v ?? 0);

export function SchoolExports({ projectId, school, groups }: { projectId: string; school: SchoolSummaryRow; groups: ClassOlympiadRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; percent: number; detail?: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [cancellable, setCancellable] = useState(false);
  const [skipped, setSkipped] = useState<{ what: string; names: string[] } | null>(null);
  const cancel = useRef(false);
  const mounted = useRef(true);
  // Leaving the page stops any zip that is still being made.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel.current = true; }; }, []);

  const combos = groups.filter((g) => num(g.evaluated) > 0);
  const className = (code: string) => groups.find((g) => g.class_code === code)?.class_name ?? `Class ${code}`;
  const noResults = combos.length === 0;

  const start = async (label: string, job: () => Promise<void>) => {
    cancel.current = false;
    setSkipped(null);
    setBusy(label);
    try {
      await job();
    } catch (e) {
      if (e instanceof Cancelled) toast.message("Stopped. Files already downloaded are still in your Downloads folder.");
      else toast.error(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      if (mounted.current) {
        setBusy(null);
        setProgress(null);
        setCancellable(false);
      }
    }
  };

  const summaryPdf = () => start("summary", async () => {
    setProgress({ stage: "Making the school summary", percent: 0 });
    const a = await fetchSchoolAnalysis(projectId, school.school_id);
    const text = a && !a.outdated
      ? [a.analysis.overview, ...(a.analysis.strengths.length ? ["Strengths:", ...a.analysis.strengths.map((s) => `- ${s}`)] : []),
        ...(a.analysis.focus_areas.length ? ["Areas to improve:", ...a.analysis.focus_areas.map((s) => `- ${s}`)] : []),
        ...(a.analysis.suggestions.length ? ["Suggestions:", ...a.analysis.suggestions.map((s) => `- ${s}`)] : [])].join("\n")
      : null;
    const avg = school.avg_percentage == null ? 0 : Number(school.avg_percentage);
    const blob = await generateSchoolSummary({
      school: { name: school.school_name ?? "School", state: school.state_name ?? undefined },
      tiles: {
        enrolled: num(school.enrolled), evaluated: num(school.evaluated), absent: num(school.absent), averagePct: avg,
        schoolGrade: school.school_grade || undefined, schoolGradeLabel: school.school_grade ? schoolGrade(avg).label : undefined,
        stateAveragePct: school.state_avg_percentage == null ? null : Number(school.state_avg_percentage),
      },
      rows: groups.map((g) => ({
        className: g.class_name ?? `Class ${g.class_code}`, olympiad: olympiadName(g.olympiad_code), enrolled: num(g.enrolled),
        evaluated: num(g.evaluated), averagePct: num(g.avg_percentage), stateAveragePct: g.state_avg_percentage == null ? null : Number(g.state_avg_percentage),
      })),
      aiAnalysis: text,
    });
    downloadBlob(`${fileSafe(school.school_name ?? "School")} - School summary.pdf`, blob);
    if (a?.outdated) toast.message("The AI analysis is out of date, so it was left out. Regenerate it to include it.");
  });

  const prepare = (kind: Kind) => start("loading", async () => {
    setProgress({ stage: "Loading this school's students", percent: 5 });
    const rows = await fetchSchoolRankRows(projectId, school.school_id, combos);
    if (rows.length === 0) throw new Error("This school has no evaluated students to make files for.");
    const lossy = rows.filter((r) => lossyText(r.student_name)).map((r) => r.student_name);
    let outdated = 0;
    if (kind === "skillZip") {
      const fb = await fetchFeedback(rows.map((r) => r.enrollment_id), { projectId, schoolId: school.school_id });
      outdated = [...fb.values()].filter((f) => f.outdated).length;
    }
    if (lossy.length > 0 || outdated > 0) { setPending({ kind, rows, lossy, outdated }); return; }
    await run(kind, rows);
  });

  const run = (kind: Kind, rows: RankRow[]) => (kind === "ranking" ? rankingPdf(rows) : kind === "scoreZip" ? scoreZip(rows) : skillZip(rows));

  const rankingPdf = async (rows: RankRow[]) => {
    setProgress({ stage: "Making the school ranking", percent: 50 });
    const blob = await generateSchoolRanking({
      school: { name: school.school_name ?? "School" },
      rows: rows.map((r) => ({
        name: r.student_name, regNo: formatRegSafe(r.registration_number), className: className(r.class_code), olympiad: olympiadName(r.olympiad_code),
        score: `${r.total} / ${r.max_marks}`, percentage: num(r.percentage), grade: r.grade,
        schoolRank: r.rank_school, districtRank: r.rank_district, stateRank: r.rank_state, allIndiaRank: r.rank_national,
      })),
    });
    downloadBlob(`${fileSafe(school.school_name ?? "School")} - School ranking.pdf`, blob);
  };

  const zipRun = async (count: number, noun: string, label: string, job: ZipJob) => {
    let parts = 0;
    setCancellable(true);
    setProgress({ stage: exportStage(0, count, noun), percent: 0 });
    if (job.skipped) setSkipped(job.skipped);
    await streamZipParts(job.inputs.map((i) => ({ name: i.name, make: i.make })), {
      count: job.inputs.length,
      partName: zipPartName(school.school_name ?? "School", label),
      onPart: (p) => { parts++; downloadBlob(p.name, p.blob); },
    });
    toast.success(`Done. ${parts} zip ${parts === 1 ? "file" : "files"} downloaded. If your browser asked to allow several downloads, choose Allow.`);
  };

  // Cancel check, yield to the page and progress around every PDF.
  const wrapper = (total: { n: number }, noun: string): MakeWrap => {
    let done = 0;
    return async (make) => {
      if (cancel.current) throw new Cancelled();
      await yieldToUi();
      const b = await make();
      done++;
      setProgress({ stage: exportStage(done, total.n, noun), percent: percentOf(done, total.n) });
      return b;
    };
  };
  const ctx: SchoolZipContext = { projectId, schoolId: school.school_id, schoolName: school.school_name ?? "School", className };

  const scoreZip = async (rows: RankRow[]) => {
    setProgress({ stage: "Getting the answers ready", percent: 0 });
    const total = { n: rows.length };
    const job = await scoreSheetJob(ctx, rows, wrapper(total, "score sheets"));
    total.n = job.inputs.length;
    await zipRun(job.inputs.length, "score sheets", "Score sheets", job);
  };

  const skillZip = async (rows: RankRow[]) => {
    setProgress({ stage: "Getting skills and feedback ready", percent: 0 });
    const total = { n: rows.length };
    const job = await skillReportJob(ctx, rows, wrapper(total, "skill reports"));
    total.n = job.inputs.length;
    await zipRun(job.inputs.length, "skill reports", "Skill reports", job);
  };

  const disabled = !!busy;
  const btn = (label: string, Icon: typeof Download, onClick: () => void, off = false) => (
    <Button type="button" variant="outline" className="min-h-11" disabled={disabled || off} onClick={onClick}>
      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />{label}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {btn("School summary PDF", FileText, summaryPdf, noResults)}
        {btn("School ranking PDF", ListOrdered, () => prepare("ranking"), noResults)}
        {btn("Score-sheet zip", Archive, () => prepare("scoreZip"), noResults)}
        {btn("Skill-report zip", Archive, () => prepare("skillZip"), noResults)}
      </div>
      {noResults && <p className="text-sm text-muted-foreground">These files are available once this school has evaluated students.</p>}
      {busy && progress && <ProgressPanel stage={progress.stage} percent={progress.percent} detail={progress.detail} onCancel={cancellable ? () => { cancel.current = true; } : undefined} />}

      {skipped && !busy && (
        <p className="text-base" role="status">
          {skipped.names.length} {skipped.names.length === 1 ? "student" : "students"} {skipped.what}: {skipped.names.slice(0, 10).join(", ")}{skipped.names.length > 10 ? ` and ${skipped.names.length - 10} more` : ""}.
        </p>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Check before making the files</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-base text-foreground">
                {pending && pending.lossy.length > 0 && (
                  <div>
                    <p>{pending.lossy.length} {pending.lossy.length === 1 ? "student has a name" : "students have names"} with letters the PDF cannot print. Those letters will show as a question mark (?):</p>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {pending.lossy.slice(0, 10).map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                    {pending.lossy.length > 10 && <p className="text-sm">and {pending.lossy.length - 10} more.</p>}
                  </div>
                )}
                {pending && pending.outdated > 0 && (
                  <p>{pending.outdated} {pending.outdated === 1 ? "student's" : "students'"} AI feedback is out of date because the score changed. Their reports will show skills only. Regenerate the feedback on the Skill Analysis page to include it.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => { const p = pending!; setPending(null); void start(p.kind, () => run(p.kind, p.rows)); }}>
              Make the files anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const formatRegSafe = (r: string | null) => (r ? formatReg(r) : "-");
