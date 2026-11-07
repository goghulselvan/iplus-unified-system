import { useEffect, useRef, useState } from "react";
import { Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { uploadWithProgress, type UploadKind } from "@/lib/results/uploadWithProgress";
import { readKey } from "@/lib/results/keyApi";
import { keyTemplateCsv, parseKeyCsv, type ParsedKey } from "@/lib/results/answerKeyCsv";
import { isLetter, type Letter } from "@/lib/results/questionRow";
import { downloadBlob } from "@/lib/results/downloadBlob";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paperId: string;
  projectId: string;
  totalQuestions: number;
  /** Answers already in the key, shown as the starting point for typing. */
  existing?: Record<number, Letter>;
  /** Saves the key. Rejects with a plain-English message. */
  onSave: (answers: Record<number, Letter>) => Promise<void>;
}

type Grid = Record<number, string>;
const FAILED = "Something went wrong. Please try again.";

export function KeyGrid({ total, values, onChange }: { total: number; values: Grid; onChange: (n: number, v: string) => void }) {
  const set = (n: number, raw: string) => {
    const ch = raw.slice(-1).toUpperCase();
    onChange(n, ch);
    if (isLetter(ch) && n < total) document.getElementById(`key-cell-${n + 1}`)?.focus();
  };
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
        const v = values[n] ?? "";
        const bad = v !== "" && !isLetter(v);
        return (
          <label key={n} className="block text-center text-sm font-medium">
            <span className="block tabular-nums">{n}</span>
            <input id={`key-cell-${n}`} aria-label={`Answer for question ${n}`} aria-invalid={bad} value={v} autoComplete="off"
              onChange={(e) => set(n, e.target.value)} onFocus={(e) => e.currentTarget.select()}
              className={`h-11 w-full rounded-md border bg-background text-center text-lg font-semibold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${bad ? "border-destructive" : "border-input"}`} />
          </label>
        );
      })}
    </div>
  );
}

const toAnswers = (g: Grid): Record<number, Letter> => {
  const out: Record<number, Letter> = {};
  for (const [k, v] of Object.entries(g)) if (isLetter(v)) out[Number(k)] = v;
  return out;
};
const badCells = (g: Grid) => Object.entries(g).filter(([, v]) => v !== "" && !isLetter(v)).map(([k]) => Number(k));

export function AnswerKeyDialog({ open, onOpenChange, paperId, projectId, totalQuestions, existing, onSave }: Props) {
  const [tab, setTab] = useState("csv");
  const [parsed, setParsed] = useState<ParsedKey | null>(null);
  const [csvName, setCsvName] = useState("");
  const [typed, setTyped] = useState<Grid>({});
  const [read, setRead] = useState<Grid | null>(null);
  const [job, setJob] = useState<{ stage: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("csv"); setParsed(null); setCsvName(""); setRead(null); setJob(null); setError(null); setSaving(false);
    setTyped(Object.fromEntries(Object.entries(existing ?? {}).map(([k, v]) => [k, v])));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const onCsv = async (file?: File) => {
    if (!file) return;
    setError(null);
    setCsvName(file.name);
    setParsed(parseKeyCsv(await file.text(), totalQuestions));
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setError(null); setRead(null);
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    abort.current = new AbortController();
    try {
      const key = `${projectId}/papers/${paperId}-key.${ext}`;
      await uploadWithProgress(file, key, (p) => setJob({ stage: "Uploading the answer key", percent: p * 0.6 }),
        abort.current.signal, ["pdf", "jpg", "jpeg", "png"] as UploadKind[]);
      // One call with no real progress to report: the bar creeps towards 95% until it answers.
      setJob({ stage: "Reading the answer key", percent: 60 });
      timer.current = setInterval(() => setJob((j) => (j && j.percent < 95 ? { ...j, percent: j.percent + 1 } : j)), 400);
      const { answers } = await readKey(paperId, key);
      const g: Grid = {};
      for (const a of answers) if (a.question_number >= 1 && a.question_number <= totalQuestions && a.answer) g[a.question_number] = String(a.answer).toUpperCase();
      setJob({ stage: "Reading the answer key", percent: 100 });
      setRead(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : FAILED);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setTimeout(() => setJob(null), 300);
    }
  };

  const grid = tab === "type" ? typed : read ?? {};
  const answers = tab === "csv" ? parsed?.answers ?? {} : toAnswers(grid);
  const bad = tab === "csv" ? [] : badCells(grid);
  const count = Object.keys(answers).length;
  const canSave = !saving && !job && count > 0 && bad.length === 0 && (tab !== "csv" || (parsed?.errors.length ?? 1) === 0);

  const save = async () => {
    setSaving(true); setError(null);
    try { await onSave(answers); onOpenChange(false); }
    catch (e) { setError(e instanceof Error ? e.message : FAILED); }
    finally { setSaving(false); }
  };

  const fileInput = (accept: string, label: string, handler: (f?: File) => void) => (
    <input type="file" accept={accept} aria-label={label}
      className="block w-full cursor-pointer rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
      onChange={(e) => { handler(e.target.files?.[0]); e.target.value = ""; }} />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload answer key</DialogTitle>
          <DialogDescription>
            The printed answer key is the source of truth. The AI will double-check every question where it disagrees with the key.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="csv" className="min-h-11">CSV file</TabsTrigger>
            <TabsTrigger value="file" className="min-h-11">PDF or photo</TabsTrigger>
            <TabsTrigger value="type" className="min-h-11">Type it in</TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-3">
            <Button type="button" variant="outline" className="min-h-11"
              onClick={() => downloadBlob("answer-key-template.csv", new Blob([keyTemplateCsv(totalQuestions)], { type: "text/csv" }))}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />Download the template
            </Button>
            <p className="text-sm text-muted-foreground">Fill in the answer column with A, B, C or D, then choose the file.</p>
            {fileInput(".csv,text/csv", "Choose the answer key CSV file", onCsv)}
            {parsed && (
              <div className="space-y-2" role="status">
                <p className="text-base font-medium">
                  {csvName}: {Object.keys(parsed.answers).length} of {totalQuestions} answers found
                </p>
                {parsed.errors.length > 0 && (
                  <ul role="alert" className="list-disc space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 pl-8 text-sm">
                    {parsed.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}
                    {parsed.errors.length > 12 && <li>and {parsed.errors.length - 12} more problems</li>}
                  </ul>
                )}
                {parsed.errors.length === 0 && parsed.missing.length > 0 && (
                  <p className="text-sm text-muted-foreground">No answer for question{parsed.missing.length === 1 ? "" : "s"} {parsed.missing.join(", ")}. Those will stay without a key.</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="file" className="space-y-3">
            <p className="text-sm text-muted-foreground">Upload a PDF or a clear photo of the answer key. The AI reads it, then you confirm every answer below.</p>
            {fileInput(".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png", "Choose the answer key PDF or photo", onPhoto)}
            {job && <ProgressPanel stage={job.stage} percent={job.percent} onCancel={job.stage.startsWith("Upload") ? () => abort.current?.abort() : undefined} />}
            {read && (
              <div className="space-y-3">
                <p className="text-base font-medium">Check every answer against the printed key. You can change any of them.</p>
                <KeyGrid total={totalQuestions} values={read} onChange={(n, v) => setRead({ ...read, [n]: v })} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="type" className="space-y-3">
            <p className="text-sm text-muted-foreground">Type A, B, C or D for each question. The cursor moves on by itself.</p>
            <KeyGrid total={totalQuestions} values={typed} onChange={(n, v) => setTyped({ ...typed, [n]: v })} />
          </TabsContent>
        </Tabs>

        {bad.length > 0 && <p role="alert" className="text-sm font-medium text-destructive">Question{bad.length === 1 ? "" : "s"} {bad.join(", ")} must be A, B, C or D.</p>}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="min-h-11" disabled={!canSave} onClick={save}>
            {saving ? "Saving…" : <><KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />Save key for {count} {count === 1 ? "question" : "questions"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

