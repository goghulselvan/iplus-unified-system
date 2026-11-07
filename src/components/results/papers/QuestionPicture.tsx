import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cropFigure, renderPage } from "@/lib/results/pdfPages";
import { validBox } from "@/lib/results/keyCrop";
import type { FigureBox } from "@/lib/results/questionRow";

export interface PdfSource {
  /** Stable id for caching rendered pages of this paper. */
  cacheId: string;
  /** Signed download link, or null while it is being fetched. */
  url: string | null;
}

interface Props {
  questionNumber: number;
  page: number;
  box: FigureBox | null;
  pdf: PdfSource | null;
}

function paint(target: HTMLCanvasElement | null, src: HTMLCanvasElement) {
  if (!target) return;
  target.width = src.width;
  target.height = src.height;
  target.getContext("2d")?.drawImage(src, 0, 0);
}

/** The question's picture, cropped from the uploaded PDF in the browser (no AI credits). */
export function QuestionPicture({ questionNumber, page, box, pdf }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const full = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [showFull, setShowFull] = useState(false);
  const hasBox = validBox(box);
  const url = pdf?.url ?? null;
  const cacheId = pdf?.cacheId ?? "";

  useEffect(() => {
    if (!url || !hasBox) return;
    let live = true;
    setState("loading");
    cropFigure(cacheId, url, page, box as FigureBox)
      .then((c) => { if (!live) return; paint(canvas.current, c); setState("ready"); })
      .catch(() => live && setState("failed"));
    return () => { live = false; };
  }, [url, cacheId, page, box, hasBox]);

  useEffect(() => {
    if (!showFull || !url) return;
    let live = true;
    renderPage(cacheId, url, page).then((c) => {
      // The dialog mounts its content a moment after opening.
      const tryPaint = () => (full.current ? paint(full.current, c) : live && requestAnimationFrame(tryPaint));
      tryPaint();
    }).catch(() => {});
    return () => { live = false; };
  }, [showFull, url, cacheId, page]);

  return (
    <figure className="space-y-2">
      {hasBox && (
        <div className="overflow-hidden rounded-md border bg-white">
          {state === "loading" && <div className="h-32 animate-pulse bg-muted" role="status" aria-label="Loading the picture" />}
          {state === "failed" && (
            <p className="p-3 text-sm text-muted-foreground">The picture could not be shown. Try Show full page.</p>
          )}
          <canvas ref={canvas} role="img" aria-label={`Picture for question ${questionNumber}`}
            className={`h-auto max-w-full ${state === "ready" ? "block" : "hidden"}`} />
        </div>
      )}
      <Button type="button" variant="outline" className="min-h-11" disabled={!url} onClick={() => setShowFull(true)}>
        <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />Show full page
      </Button>
      <Dialog open={showFull} onOpenChange={setShowFull}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Page {page} of the question paper</DialogTitle>
            <DialogDescription>Question {questionNumber} is on this page.</DialogDescription>
          </DialogHeader>
          <canvas ref={full} role="img" aria-label={`Full page ${page}`} className="h-auto w-full rounded border bg-white" />
        </DialogContent>
      </Dialog>
    </figure>
  );
}
