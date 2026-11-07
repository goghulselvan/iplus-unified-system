import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, KeyRound, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { uploadWithProgress } from "@/lib/results/uploadWithProgress";
import { readinessProblems, type QuestionRow } from "@/lib/results/paperRules";
import { checkStatus } from "@/lib/results/keyCheck";
import { planKeySave } from "@/lib/results/keyPlan";
import { recheckInChunks } from "@/lib/results/keyApi";
import { clearPageCache } from "@/lib/results/pdfPages";
import { isLetter, type Letter } from "@/lib/results/questionRow";
import type { EditableQuestion, KeyRowSave, PaperRow } from "@/hooks/results/usePapers";
import { AnalyzeRunner } from "./AnalyzeRunner";
import { AnswerKeyExport } from "./AnswerKeyExport";
import { QuestionCard, type QuestionEdit } from "./QuestionCard";
import { AnswerKeyDialog } from "./AnswerKeyDialog";
import type { PdfSource } from "./QuestionPicture";

export interface PaperEditorProps {
  paper: PaperRow;
  /** e.g. "Class 1 · Maths · Slot 2" */
  paperName: string;
  questions: QuestionRow[];
  skills: string[];
  /** Present when another slot holds a paper this one can be copied from. */
  copySource?: { label: string; unavailable?: string };
  onBack: () => void;
  onSave: (rows: EditableQuestion[]) => Promise<void>;
  /** Writes an uploaded answer key onto the questions. */
  onSaveKey: (rows: KeyRowSave[]) => Promise<void>;
  onSetStatus: (status: "draft" | "ready") => Promise<void>;
  onCopy: (replace: boolean) => Promise<void>;
  /** Called after anything changes on the server so the page can refetch. */
  onChanged: () => void;
}

const FAILED = "Something went wrong. Please try again.";

type FilterId = "all" | "decision" | "unsure" | "picture" | "nokey";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "decision", label: "Need decision" },
  { id: "unsure", label: "Not sure (under 70%)" },
  { id: "picture", label: "Has picture" },
  { id: "nokey", label: "No key" },
];

function PdfSection({ paper, onChanged }: { paper: PaperRow; onChanged: () => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hasPdf = !!paper.pdf_r2_key;

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setPct(0);
    abort.current = new AbortController();
    const key = `${paper.project_id}/papers/${paper.id}.pdf`;
    try {
      await uploadWithProgress(file, key, setPct, abort.current.signal, ["pdf"]);
      clearPageCache(`${paper.id}|${paper.pdf_file_name ?? ""}`);
      const { error: uErr } = await supabase
        .from("question_papers").update({ pdf_r2_key: key, pdf_file_name: file.name }).eq("id", paper.id);
      if (uErr) throw new Error("The PDF was uploaded but could not be attached to this paper. Please try again.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : FAILED);
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };

  const view = async () => {
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("results-files", {
      body: { action: "download", key: paper.pdf_r2_key },
    });
    if (err || data?.error || !data?.url) return setError(data?.error ?? "The PDF could not be opened. Please try again.");
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1}
          aria-label="Choose the PDF file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button type="button" variant={hasPdf ? "outline" : "default"} className="min-h-11" disabled={pct !== null}
          onClick={() => input.current?.click()}>
          <Upload className="mr-2 h-4 w-4" aria-hidden="true" />{hasPdf ? "Replace PDF" : "Upload PDF"}
        </Button>
        {hasPdf && (
          <Button type="button" variant="outline" className="min-h-11" onClick={view}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />View PDF
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          {hasPdf ? `PDF uploaded${paper.pdf_file_name ? `: ${paper.pdf_file_name}` : ""}` : "No PDF uploaded yet"}
        </p>
      </div>
      {pct !== null && (
        <ProgressPanel stage="Uploading the question paper" percent={pct} onCancel={() => abort.current?.abort()} />
      )}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

export default function PaperEditor(props: PaperEditorProps) {
  const { paper, paperName, questions, skills, copySource, onBack, onSave, onSaveKey, onSetStatus, onCopy, onChanged } = props;
  const [edits, setEdits] = useState<Record<number, QuestionEdit>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [filter, setFilter] = useState<FilterId>("all");
  const [keyOpen, setKeyOpen] = useState(false);
  const [recheck, setRecheck] = useState<{ done: number; total: number } | null>(null);
  const stopRecheck = useRef(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const dirtyCount = Object.keys(edits).length;
  const merged = useMemo(
    () => questions.map((q) => ({ ...q, ...(edits[q.question_number] ?? {}) }) as QuestionRow),
    [questions, edits],
  );
  const editedCount = questions.filter((q) => q.human_edited).length;
  const withStatus = useMemo(() => merged.map((q) => ({ q, status: checkStatus(q) })), [merged]);
  const counts = useMemo(() => {
    const c = { confirmed: 0, decision: 0, keyOnly: 0, noKey: 0, resolved: 0, unsure: 0, picture: 0 };
    for (const { q, status } of withStatus) {
      if (status === "confirmed") c.confirmed++;
      else if (status === "mismatch" || status === "mismatch_strong") c.decision++;
      else if (status === "key_only") c.keyOnly++;
      else if (status === "unchecked") c.noKey++;
      else if (status === "resolved") c.resolved++;
      if (q.ai_confidence !== null && Number(q.ai_confidence) < 0.7) c.unsure++;
      if (q.has_figure || q.figure_page != null) c.picture++;
    }
    return c;
  }, [withStatus]);
  const visible = useMemo(() => withStatus.filter(({ q, status }) => {
    switch (filter) {
      case "decision": return status === "mismatch" || status === "mismatch_strong";
      case "unsure": return q.ai_confidence !== null && Number(q.ai_confidence) < 0.7;
      case "picture": return !!q.has_figure || q.figure_page != null;
      case "nokey": return status === "unchecked";
      default: return true;
    }
  }), [withStatus, filter]);
  const hasKey = questions.some((q) => q.key_answer);
  const needsPictures = !!paper.pdf_r2_key && questions.some((q) => q.figure_page != null);

  useEffect(() => {
    if (!needsPictures) return;
    let live = true;
    supabase.functions.invoke("results-files", { body: { action: "download", key: paper.pdf_r2_key } })
      .then(({ data }) => { if (live && data?.url) setPdfUrl(data.url); })
      .catch(() => {});
    return () => { live = false; };
  }, [needsPictures, paper.pdf_r2_key, paper.pdf_file_name]);
  const pdf: PdfSource | null = needsPictures ? { cacheId: `${paper.id}|${paper.pdf_file_name ?? ""}`, url: pdfUrl } : null;

  const goTo = (from: number, dir: 1 | -1) => {
    const i = visible.findIndex(({ q }) => q.question_number === from);
    const next = visible[i + dir];
    if (!next) return;
    const el = document.getElementById(`q-card-${next.q.question_number}`);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest" });
  };

  const runRecheck = async (numbers: number[]) => {
    stopRecheck.current = false;
    setRecheck({ done: 0, total: numbers.length });
    try {
      await recheckInChunks(paper.id, numbers, (done, total) => setRecheck({ done, total }), () => stopRecheck.current);
      setNotice({ kind: "ok", text: stopRecheck.current ? "Stopped. The questions checked so far are saved." : "The AI has double-checked the questions. Please look at the ones marked Please check." });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : FAILED });
    } finally {
      setRecheck(null);
      onChanged();
    }
  };

  const saveKey = async (answers: Record<number, Letter>) => {
    const plan = planKeySave(questions, answers);
    if (!plan.rows.length) throw new Error("None of these answers match a question on this paper yet.");
    await onSaveKey(plan.rows);
    onChanged();
    setNotice({ kind: "ok", text: `The answer key is saved for ${plan.rows.length} ${plan.rows.length === 1 ? "question" : "questions"}.${plan.toRecheck.length ? ` The AI will now recheck ${plan.toRecheck.length} where it disagrees.` : ""}` });
    if (plan.toRecheck.length) void runRecheck(plan.toRecheck);
  };

  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyCount]);

  const change = (n: number, patch: QuestionEdit) =>
    setEdits((prev) => ({ ...prev, [n]: { ...(prev[n] ?? {}), ...patch } }));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const rows: EditableQuestion[] = Object.keys(edits).map((k) => {
        const n = Number(k);
        const m = merged.find((q) => q.question_number === n)!;
        return {
          question_number: n, correct_answer: m.correct_answer, is_grace: m.is_grace,
          skill_category: m.skill_category, cognitive_level: m.cognitive_level,
          ...(edits[n].check_status ? { check_status: edits[n].check_status } : {}),
        };
      });
      await onSave(rows);
      setEdits({});
      setNotice({ kind: "ok", text: "Your changes are saved." });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : FAILED });
    } finally {
      setSaving(false);
    }
  };

  const markReady = async () => {
    setNotice(null);
    if (dirtyCount) {
      setProblems([]);
      return setNotice({ kind: "error", text: "Save your changes before marking this paper as Ready." });
    }
    const p = readinessProblems(merged, paper.total_questions);
    setProblems(p);
    if (p.length) return;
    try {
      await onSetStatus("ready");
      setNotice({ kind: "ok", text: "This paper is now Ready." });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : FAILED });
    }
  };

  const backToDraft = async () => {
    try { await onSetStatus("draft"); } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : FAILED });
    }
  };

  const doCopy = async (replace: boolean) => {
    setConfirmCopy(false);
    setNotice(null);
    try {
      await onCopy(replace);
      setEdits({});
      setNotice({ kind: "ok", text: `Copied the questions from ${copySource?.label}.` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : FAILED });
    }
  };

  const goBack = () => (dirtyCount ? setConfirmLeave(true) : onBack());
  const ready = paper.status === "ready";

  return (
    <div className="space-y-4 pb-24">
      <Button type="button" variant="ghost" className="-ml-3 min-h-11" onClick={goBack}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />All question papers
      </Button>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold">{paperName}</h3>
            <Badge variant={ready ? "default" : "secondary"} className="text-sm">{ready ? "Ready" : "Draft"}</Badge>
          </div>

          <PdfSection paper={paper} onChanged={onChanged} />
          <AnalyzeRunner paperId={paper.id} totalQuestions={paper.total_questions} hasPdf={!!paper.pdf_r2_key}
            editedCount={editedCount} disabledReason={dirtyCount ? "Save or discard your changes first" : undefined}
            onDone={() => { setEdits({}); onChanged(); }} />
          <div className="space-y-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setKeyOpen(true)}
              disabled={!!recheck || dirtyCount > 0 || questions.length === 0}>
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />{hasKey ? "Replace answer key" : "Upload answer key"}
            </Button>
            {questions.length === 0 && <p className="text-sm text-muted-foreground">Read the questions with the AI first, then add the answer key.</p>}
          </div>
          {recheck && (
            <ProgressPanel
              stage={`Rechecking ${recheck.total} ${recheck.total === 1 ? "question" : "questions"}…`}
              percent={recheck.total ? (recheck.done / recheck.total) * 100 : 0}
              detail="The AI is solving each one again without seeing the key"
              onCancel={() => { stopRecheck.current = true; }}
            />
          )}
          {paper.analysis_status === "failed" && paper.analysis_error && (
            <p role="alert" className="text-sm font-medium text-destructive">{paper.analysis_error}</p>
          )}

          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t pt-4">
            {copySource && (
              <div className="flex flex-col gap-1">
                <Button type="button" variant="outline" className="min-h-11" disabled={!!copySource.unavailable}
                  onClick={() => (questions.length || dirtyCount ? setConfirmCopy(true) : doCopy(false))}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copy from {copySource.label}
                </Button>
                {copySource.unavailable && <p className="max-w-xs text-sm text-muted-foreground">{copySource.unavailable}</p>}
              </div>
            )}
            <AnswerKeyExport paperName={paperName} questions={merged} />
            {ready ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={backToDraft}>Move back to draft</Button>
            ) : (
              <Button type="button" className="min-h-11" onClick={markReady}>Mark as Ready</Button>
            )}
          </div>

          {problems.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
              <p className="text-base font-semibold">This paper is not ready yet</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}
          {notice && (
            <p role={notice.kind === "error" ? "alert" : "status"}
              className={`text-sm font-medium ${notice.kind === "error" ? "text-destructive" : "text-green-800"}`}>
              {notice.text}
            </p>
          )}
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-base text-muted-foreground">
            No questions yet. Upload the PDF and choose Analyse with AI, or copy them from another slot.
          </CardContent>
        </Card>
      ) : (
        <section aria-label={`Questions for ${paperName}`} className="space-y-4">
          <div className="space-y-3">
            <p className="text-lg font-semibold" role="status" data-testid="key-summary">
              {counts.confirmed} confirmed · {counts.decision} {counts.decision === 1 ? "needs" : "need"} your decision · {counts.keyOnly} key only · {counts.noKey} no key
              {counts.resolved > 0 && ` · ${counts.resolved} resolved`}
            </p>
            <div role="group" aria-label="Show questions" className="flex flex-wrap gap-2">
              {FILTERS.map((f) => {
                const n = f.id === "all" ? questions.length : f.id === "decision" ? counts.decision
                  : f.id === "unsure" ? counts.unsure : f.id === "picture" ? counts.picture : counts.noKey;
                return (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                    className={`min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      filter === f.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                    {f.label} ({n})
                  </button>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              Keyboard: A, B, C or D sets the answer, G switches grace on or off, Enter or the down arrow goes to the next question, the up arrow goes back.
            </p>
          </div>
          {visible.length === 0 ? (
            <div className="rounded-lg border p-6">
              <p className="text-base">No questions match this filter.</p>
              <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setFilter("all")}>Show all questions</Button>
            </div>
          ) : visible.map(({ q }) => {
            const original = questions.find((x) => x.question_number === q.question_number)!;
            return (
              <QuestionCard key={original.id} question={original} edit={edits[q.question_number]} skills={skills}
                pdf={pdf} onChange={change} onNav={goTo} />
            );
          })}
        </section>
      )}

      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-lg backdrop-blur">
          <div className="container mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <p className="text-base font-medium" role="status">
              {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setEdits({})}>
                Discard
              </Button>
              <Button type="button" className="min-h-11" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AnswerKeyDialog open={keyOpen} onOpenChange={setKeyOpen} paperId={paper.id} projectId={paper.project_id}
        totalQuestions={paper.total_questions} onSave={saveKey}
        existing={Object.fromEntries(questions.filter((q) => isLetter(q.key_answer)).map((q) => [q.question_number, q.key_answer as Letter]))} />

      <AlertDialog open={confirmCopy} onOpenChange={setConfirmCopy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the questions on this paper?</AlertDialogTitle>
            <AlertDialogDescription>
              Copying from {copySource?.label} replaces the questions here, including any corrections you made.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <Button type="button" className="min-h-11" onClick={() => doCopy(true)}>Replace with copy</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}. They will be lost if you leave.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Stay and keep editing</AlertDialogCancel>
            <Button type="button" variant="outline" className="min-h-11" onClick={onBack}>Leave without saving</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
