import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { parseEvaluationCsv, buildTemplateCsv, type CsvRow } from "@/lib/results/evaluationCsv";
import {
  fetchTemplateStudents, useUploadRpc, type UploadCheckResult, type UploadDryRun, type UploadError,
} from "@/hooks/results/useEvaluations";
import type { PaperSummary } from "@/hooks/results/usePapers";
import { ErrorList } from "./ErrorList";
import { ReplaceWarning } from "./ReplaceWarning";
import { downloadText } from "./download";

interface Props { paper: PaperSummary; kind: "manual" | "omr"; label: string; onBusyChange?: (busy: boolean) => void }

type Phase =
  | { t: "idle" }
  | { t: "reading"; pct: number }
  | { t: "checking"; pct: number; count: number }
  | { t: "errors"; errors: UploadError[]; more: number }
  | { t: "ready"; result: UploadDryRun; rows: CsvRow[]; fileName: string; paperId: string }
  | { t: "saving"; pct: number };

/** Moves a bar between two values while a server call with no progress events is running. */
function useCreep(active: boolean, set: (pct: number) => void, from: number, to: number) {
  useEffect(() => {
    if (!active) return;
    let pct = from;
    const id = setInterval(() => { pct = Math.min(to, pct + (to - pct) * 0.08 + 0.3); set(Math.round(pct)); }, 250);
    return () => clearInterval(id);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function UploadChecker({ paper, kind, label, onBusyChange }: Props) {
  const rpc = useUploadRpc();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ t: "idle" });
  const [ack, setAck] = useState(false);
  const [busyTemplate, setBusyTemplate] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => { setPhase({ t: "idle" }); setAck(false); }, [paper.id]);
  const isBusy = phase.t === "reading" || phase.t === "checking" || phase.t === "saving";
  useEffect(() => { onBusyChange?.(isBusy); }, [isBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useCreep(phase.t === "checking", (pct) => setPhase((p) => (p.t === "checking" ? { ...p, pct } : p)), 40, 90);
  useCreep(phase.t === "saving", (pct) => setPhase((p) => (p.t === "saving" ? { ...p, pct } : p)), 10, 90);

  const template = async () => {
    setBusyTemplate(true);
    try {
      const students = await fetchTemplateStudents(paper.project_id, paper.class_code, paper.olympiad_code);
      downloadText(`${label.replace(/[^\w]+/g, "-")}-template.csv`, buildTemplateCsv(paper.total_questions, students));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusyTemplate(false); }
  };

  const readFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onprogress = (e) => e.lengthComputable && setPhase({ t: "reading", pct: Math.round((e.loaded / e.total) * 40) });
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.onerror = () => reject(new Error("We could not read this file. Please choose it again."));
      fr.readAsText(file);
    });

  const choose = async (file: File | undefined) => {
    if (!file) return;
    // Clear now so choosing the same (edited) file again still fires a change event.
    if (input.current) input.current.value = "";
    setAck(false);
    if (!/\.csv$/i.test(file.name)) {
      setPhase({ t: "errors", errors: [{ row: 0, message: "Please choose a .csv file. Save your spreadsheet as CSV first." }], more: 0 });
      return;
    }
    try {
      setPhase({ t: "reading", pct: 0 });
      const text = await readFile(file);
      const parsed = parseEvaluationCsv(text, kind, paper.total_questions);
      if (parsed.errors.length) { setPhase({ t: "errors", errors: parsed.errors, more: 0 }); return; }
      setPhase({ t: "checking", pct: 40, count: parsed.rows.length });
      const result: UploadCheckResult = await rpc.check({ paperId: paper.id, kind, fileName: file.name, rows: parsed.rows });
      if (result.ok === false) { setPhase({ t: "errors", errors: result.errors, more: result.moreErrors }); return; }
      setPhase({ t: "ready", result, rows: parsed.rows, fileName: file.name, paperId: paper.id });
    } catch (e) {
      setPhase({ t: "errors", errors: [{ row: 0, message: (e as Error).message }], more: 0 });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const confirm = async () => {
    if (phase.t !== "ready") return;
    const { rows, fileName, paperId } = phase;
    setPhase({ t: "saving", pct: 10 });
    try {
      const r = await rpc.save({ paperId, kind, fileName, rows });
      if (r.ok === false) { setPhase({ t: "errors", errors: r.errors, more: r.moreErrors }); return; }
      toast.success(`${r.saved} results saved. Ranks updated.`);
      setPhase({ t: "idle" });
    } catch (e) {
      setPhase({ t: "errors", errors: [{ row: 0, message: (e as Error).message }], more: 0 });
    }
  };

  const busy = phase.t === "reading" || phase.t === "checking" || phase.t === "saving";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={template} disabled={busyTemplate} className="min-h-11">
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {busyTemplate ? "Preparing template" : "Download template"}
        </Button>
        <p className="text-sm text-muted-foreground">
          The template lists every registered student for this paper, with an empty box for each of the {paper.total_questions} questions.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) choose(e.dataTransfer.files[0]); }}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${drag ? "border-primary bg-muted" : "border-input"}`}
      >
        <FileUp className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-base">Drop the CSV file here, or</p>
        <Button type="button" onClick={() => input.current?.click()} disabled={busy} className="mt-3 min-h-11">Choose file</Button>
        <input
          ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Answers file (CSV)"
          disabled={busy} onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>

      {phase.t === "reading" && <ProgressPanel stage="Reading file" percent={phase.pct} />}
      {phase.t === "checking" && <ProgressPanel stage={`Checking ${phase.count} students`} percent={phase.pct} />}
      {phase.t === "saving" && <ProgressPanel stage="Saving and calculating ranks" percent={phase.pct} />}
      {phase.t === "errors" && <ErrorList errors={phase.errors} moreErrors={phase.more} />}
      {phase.t === "ready" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-700/40 bg-green-50 p-4 text-green-950">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-lg font-semibold">{phase.result.count} students ready to save</p>
                <p className="text-sm">The file passed every check. Nothing has been saved yet.</p>
              </div>
            </div>
          </div>
          <ReplaceWarning replace={phase.result.replace} acknowledged={ack} onAcknowledge={setAck} />
          {phase.result.otherSlot.count > 0 && (
            <p className="rounded-lg border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">
              {phase.result.otherSlot.count} students are from schools booked on {phase.result.otherSlot.slotName ?? "the other slot"}. They will still be saved.
            </p>
          )}
          {phase.result.missingFromFile > 0 && (
            <p className="text-sm text-muted-foreground">
              {phase.result.missingFromFile} registered students are not in this file (they will stay Pending).
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={confirm} disabled={phase.result.replace.length > 0 && !ack} className="min-h-11">
              Confirm and save
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhase({ t: "idle" })} className="min-h-11">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
