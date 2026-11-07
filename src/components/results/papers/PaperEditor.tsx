import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Upload } from "lucide-react";
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
import type { EditableQuestion, PaperRow } from "@/hooks/results/usePapers";
import { AnalyzeRunner } from "./AnalyzeRunner";
import { AnswerKeyExport } from "./AnswerKeyExport";
import { QuestionRowEditor, type QuestionEdit } from "./QuestionRowEditor";

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
  onSetStatus: (status: "draft" | "ready") => Promise<void>;
  onCopy: (replace: boolean) => Promise<void>;
  /** Called after anything changes on the server so the page can refetch. */
  onChanged: () => void;
}

const FAILED = "Something went wrong. Please try again.";

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
  const { paper, paperName, questions, skills, copySource, onBack, onSave, onSetStatus, onCopy, onChanged } = props;
  const [edits, setEdits] = useState<Record<number, QuestionEdit>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const dirtyCount = Object.keys(edits).length;
  const merged = useMemo(
    () => questions.map((q) => ({ ...q, ...(edits[q.question_number] ?? {}) }) as QuestionRow),
    [questions, edits],
  );
  const editedCount = questions.filter((q) => q.human_edited).length;

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
        return { question_number: n, correct_answer: m.correct_answer, is_grace: m.is_grace, skill_category: m.skill_category, cognitive_level: m.cognitive_level };
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

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {questions.length === 0 ? (
            <p className="p-6 text-base text-muted-foreground">
              No questions yet. Upload the PDF and choose Analyse with AI, or copy them from another slot.
            </p>
          ) : (
            <table className="w-full min-w-[960px] text-left">
              <caption className="sr-only">Questions for {paperName}</caption>
              <thead className="border-b bg-muted/50 text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">No.</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Question</th>
                  <th scope="col" className="px-2 py-2 font-semibold"><span className="sr-only">Picture</span></th>
                  <th scope="col" className="px-3 py-2 font-semibold">Answer</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Grace</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Skill</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Thinking level</th>
                  <th scope="col" className="px-3 py-2 font-semibold">AI confidence</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <QuestionRowEditor key={q.id} question={q} edit={edits[q.question_number]} skills={skills} onChange={change} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

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
