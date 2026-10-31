import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { ProgressPanel } from "@/components/results/ProgressPanel";

const CHUNK = 20;

interface Props {
  paperId: string;
  totalQuestions: number;
  hasPdf: boolean;
  /** How many questions a person has corrected already. */
  editedCount: number;
  onDone: () => void;
  /** When set, Analyse is disabled and this text explains why. */
  disabledReason?: string;
}

export function AnalyzeRunner({ paperId, totalQuestions, hasPdf, editedCount, onDone, disabledReason }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [range, setRange] = useState<[number, number]>([1, Math.min(CHUNK, totalQuestions)]);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const cancelled = useRef(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const run = async (overwriteEdited: boolean) => {
    setConfirming(false);
    setMessage(null);
    cancelled.current = false;
    setStopping(false);
    setRunning(true);
    setPercent(0);
    let finished = true;
    try {
      for (let from = 1; from <= totalQuestions; from += CHUNK) {
        if (cancelled.current) { finished = false; break; }
        const to = Math.min(from + CHUNK - 1, totalQuestions);
        setRange([from, to]);
        // Chunks run one after another so the second can reuse the first's cached PDF.
        const { data, error } = await supabase.functions.invoke("analyze-paper", {
          body: { paperId, from, to, overwriteEdited },
        });
        let problem: string | null = data?.error ?? null;
        if (!problem && error) {
          try {
            const body = await (error as { context?: Response }).context?.json();
            problem = typeof body?.error === "string" ? body.error : null;
          } catch { /* use the generic message */ }
          problem = problem ?? "The AI could not read this paper. Please try again.";
        }
        if (problem) { setMessage({ kind: "error", text: problem }); finished = false; break; }
        setPercent(Math.round((to / totalQuestions) * 100));
      }
      if (finished) setMessage({ kind: "info", text: "Finished reading. Please check the highlighted questions." });
      else if (cancelled.current) setMessage({ kind: "info", text: "Stopped. The questions read so far are saved." });
    } catch {
      setMessage({ kind: "error", text: "The AI could not read this paper. Please check the internet connection and try again." });
    } finally {
      setRunning(false);
      onDone();
    }
  };

  const start = () => (editedCount > 0 ? setConfirming(true) : run(true));

  return (
    <div className="space-y-3">
      <Button type="button" onClick={start} disabled={!hasPdf || running || !!disabledReason} className="min-h-11">
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        Analyse with AI
      </Button>
      {disabledReason && <p className="text-sm text-muted-foreground">{disabledReason}</p>}
      {!hasPdf && <p className="text-sm text-muted-foreground">Upload the PDF first.</p>}
      {running && (
        <ProgressPanel
          stage={stopping ? "Stopping after this batch" : `Reading questions ${range[0]}–${range[1]}`}
          percent={percent}
          detail={`${totalQuestions} questions in this paper`}
          onCancel={() => { cancelled.current = true; setStopping(true); }}
        />
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm font-medium ${message.kind === "error" ? "text-destructive" : "text-foreground"}`}>
          {message.text}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent onOpenAutoFocus={(e) => { e.preventDefault(); keepRef.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Read this paper again?</AlertDialogTitle>
            <AlertDialogDescription>
              {editedCount} {editedCount === 1 ? "question has" : "questions have"} been corrected by a person.
              {" "}Keep my corrections reads the other questions and leaves yours alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => run(true)}>
              Replace my corrections
            </Button>
            <Button ref={keepRef} type="button" className="min-h-11" onClick={() => run(false)}>
              Keep my corrections
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
