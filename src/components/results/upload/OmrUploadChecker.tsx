import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { readOmrFile, type OmrRow } from "@/lib/results/omrFile";
import { readManualFile, type ManualRow } from "@/lib/results/manualFile";
import { omrErrorGroups } from "@/lib/results/omrErrors";
import { useOmrUploadRpc, type OmrDryRun, type OmrUploadError, type SkippedRow } from "@/hooks/results/useOmrUpload";
import { ErrorList } from "./ErrorList";
import { ReplaceWarning } from "./ReplaceWarning";

interface Props {
  projectId: string;
  /** omr: Class 3+ OMR answers. manual: LKG-Class 2 hand marks (per question or totals only). */
  mode?: "omr" | "manual";
  onBusyChange?: (busy: boolean) => void;
}

type Phase =
  | { t: "idle" }
  | { t: "reading"; pct: number }
  | { t: "checking"; pct: number; count: number }
  | { t: "errors"; errors: OmrUploadError[]; more: number }
  | { t: "ready"; result: OmrDryRun; rows: OmrRow[] | ManualRow[]; fileName: string }
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

const fileError = (message: string): OmrUploadError => ({ row: 0, kind: "file", reg: null, message });

export function OmrUploadChecker({ projectId, mode = "omr", onBusyChange }: Props) {
  const rpc = useOmrUploadRpc(mode);
  const manual = mode === "manual";
  const sheetsWord = manual ? "students" : "answer sheets";
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ t: "idle" });
  const [ack, setAck] = useState(false);
  const [drag, setDrag] = useState(false);

  const busy = phase.t === "reading" || phase.t === "checking" || phase.t === "saving";
  useEffect(() => { onBusyChange?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useCreep(phase.t === "checking", (pct) => setPhase((p) => (p.t === "checking" ? { ...p, pct } : p)), 30, 90);
  useCreep(phase.t === "saving", (pct) => setPhase((p) => (p.t === "saving" ? { ...p, pct } : p)), 10, 90);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    // Clear now so choosing the same (edited) file again still fires a change event.
    if (input.current) input.current.value = "";
    setAck(false);
    try {
      setPhase({ t: "reading", pct: 10 });
      const parsed = manual ? await readManualFile(file) : await readOmrFile(file);
      if (parsed.errors.length) {
        setPhase({ t: "errors", errors: parsed.errors.map((e) => fileError(e.message)), more: 0 });
        return;
      }
      setPhase({ t: "checking", pct: 30, count: parsed.rows.length });
      const result = await rpc.check({ projectId, fileName: file.name, rows: parsed.rows });
      if (result.ok === false) { setPhase({ t: "errors", errors: result.errors, more: result.moreErrors }); return; }
      setPhase({ t: "ready", result, rows: parsed.rows, fileName: file.name });
    } catch (e) {
      setPhase({ t: "errors", errors: [fileError((e as Error).message)], more: 0 });
    }
  };

  const confirm = async () => {
    if (phase.t !== "ready") return;
    const { rows, fileName } = phase;
    setPhase({ t: "saving", pct: 10 });
    try {
      const r = await rpc.save({ projectId, fileName, rows });
      if (r.ok === false) { setPhase({ t: "errors", errors: r.errors, more: r.moreErrors }); return; }
      const waiting = manual ? 0 : r.papers.filter((p) => !p.keyReady).reduce((n, p) => n + p.count, 0);
      toast.success(
        manual
          ? `${r.saved} students' marks saved. Ranks updated.`
          : waiting > 0
          ? `${r.saved} students' answers saved. ${waiting} will be marked once their answer key is entered.`
          : `${r.saved} students' answers saved and marked. Ranks updated.`,
      );
      setPhase({ t: "idle" });
    } catch (e) {
      setPhase({ t: "errors", errors: [fileError((e as Error).message)], more: 0 });
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) choose(e.dataTransfer.files[0]); }}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${drag ? "border-primary bg-muted" : "border-input"}`}
      >
        <FileUp className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-base">Drop the {manual ? "marks" : "OMR"} file (.xlsx or .csv) here, or</p>
        <Button type="button" onClick={() => input.current?.click()} disabled={busy} className="mt-3 min-h-11">Choose file</Button>
        <input
          ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only" aria-label={manual ? "Marks file" : "OMR answers file"} disabled={busy} onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>

      {phase.t === "reading" && <ProgressPanel stage="Reading file" percent={phase.pct} />}
      {phase.t === "checking" && <ProgressPanel stage={`Checking ${phase.count} ${sheetsWord}`} percent={phase.pct} />}
      {phase.t === "saving" && <ProgressPanel stage={manual ? "Saving marks and ranks" : "Saving answers and marking"} percent={phase.pct} />}

      {phase.t === "errors" && (
        <div className="space-y-3">
          {omrErrorGroups(phase.errors).length > 0 && (
            <ul className="space-y-2">
              {omrErrorGroups(phase.errors).map((g) => (
                <li key={g.kind} className="rounded-lg border border-destructive/40 bg-white p-3 text-sm">
                  <p className="font-semibold">{g.title}</p>
                  <p className="mt-1">{g.fix}</p>
                  <p className="mt-1 break-words text-muted-foreground">{g.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <ErrorList errors={phase.errors} moreErrors={phase.more}
            title="This file was not saved. Nothing has been stored. Fix every row below and upload the file again." />
        </div>
      )}

      {phase.t === "ready" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-700/40 bg-green-50 p-4 text-green-950">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-lg font-semibold">All {phase.result.count} {sheetsWord} passed every check</p>
                <p className="text-sm">Nothing has been saved yet. Check the summary, then save.</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead>{manual ? "Marks" : "Marking"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {phase.result.papers.map((p) => (
                  <TableRow key={`${p.classCode}-${p.olympiadCode}-${p.slotName}`}>
                    <TableCell>{p.className}</TableCell>
                    <TableCell>{p.olympiad}</TableCell>
                    <TableCell>{p.slotName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                    <TableCell className="text-sm">
                      {manual
                        ? (p.totalsOnly ?? 0) === p.count ? "Total only"
                          : (p.totalsOnly ?? 0) > 0 ? `Per question; ${p.totalsOnly} total only` : "Per question"
                        : p.keyReady
                        ? "Marked as soon as you save"
                        : p.paperExists
                          ? "Saved now, marked once the answer key is complete"
                          : "Saved now, marked once the question paper and answer key are added"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <SkippedNote skipped={phase.result.skipped} />
          <ReplaceWarning replace={phase.result.replace} acknowledged={ack} onAcknowledge={setAck} />
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={confirm} disabled={phase.result.replacing > 0 && !ack} className="min-h-11">
              Save {phase.result.count} {sheetsWord}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhase({ t: "idle" })} className="min-h-11">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Manual files: rows with no marks were left out; those students stay Pending. */
function SkippedNote({ skipped }: { skipped?: SkippedRow[] }) {
  if (!skipped?.length) return null;
  const n = skipped.length;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {n} {n === 1 ? "row has" : "rows have"} no marks and will be skipped. Those students stay Pending: mark them absent or type their marks on their page.
      </summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {skipped.map((r, i) => (
          <li key={i}>{r.sheet ? `Sheet "${r.sheet}", ` : ""}row {r.row}: {r.reg ?? "no roll number"}{r.name ? ` (${r.name})` : ""}</li>
        ))}
      </ul>
    </details>
  );
}
