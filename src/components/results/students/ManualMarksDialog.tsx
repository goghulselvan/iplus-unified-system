import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useManualEntry } from "@/hooks/results/useEvaluations";

type Mode = "total" | "questions" | "absent";
const MARKS = ["0", "0.5", "1"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentId: string;
  studentName: string;
  questionCount: number;
  /** What the student has now, to start the form from. */
  current: { status: "evaluated" | "absent" | null; total: number | null; marks: (number | null)[] | null };
}

/** LKG-Class 2: type a student's total, their mark per question, or mark them absent. */
export function ManualMarksDialog({ open, onOpenChange, enrollmentId, studentName, questionCount, current }: Props) {
  const entry = useManualEntry();
  const [mode, setMode] = useState<Mode>(current.status === "absent" ? "absent" : current.marks ? "questions" : "total");
  const [total, setTotal] = useState(current.total != null ? String(current.total) : "");
  const [marks, setMarks] = useState<string[]>(() =>
    Array.from({ length: questionCount }, (_, i) => (current.marks?.[i] != null ? String(current.marks[i]) : "")));
  const [error, setError] = useState<string | null>(null);

  const sum = marks.reduce((n, m) => n + (m === "" ? 0 : Number(m)), 0);
  const save = async () => {
    setError(null);
    let t: number | null = null;
    if (mode === "total") {
      t = Number(total);
      if (total.trim() === "" || !Number.isFinite(t) || t < 0 || t > questionCount || t * 2 !== Math.trunc(t * 2)) {
        setError(`Enter a total from 0 to ${questionCount}, in steps of 0.5.`);
        return;
      }
    }
    try {
      await entry.mutateAsync({
        enrollmentId, mode, total: t,
        marks: mode === "questions" ? marks.map((m) => (m === "" ? null : Number(m))) : null,
      });
      toast.success(mode === "absent" ? `${studentName} is marked absent.` : `${studentName}'s marks are saved. Ranks updated.`);
      onOpenChange(false);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !entry.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marks for {studentName}</DialogTitle>
          <DialogDescription>Saving replaces this student's current result. The old one can be restored for 30 days.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-3">
          {([["total", "Total marks only"], ["questions", "Marks per question"], ["absent", "Absent"]] as const).map(([v, l]) => (
            <div key={v} className="flex items-center gap-3">
              <RadioGroupItem value={v} id={`mm-${v}`} className="h-5 w-5" />
              <Label htmlFor={`mm-${v}`} className="text-base">{l}</Label>
            </div>
          ))}
        </RadioGroup>
        {mode === "total" && (
          <div className="space-y-1">
            <Label htmlFor="mm-total-value">Total (0 to {questionCount})</Label>
            <Input id="mm-total-value" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="min-h-11 w-32" />
          </div>
        )}
        {mode === "questions" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Choose 0, ½ or 1 for each question. A question left empty counts as 0. Total: {sum}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {marks.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Label htmlFor={`mm-q${i + 1}`} className="w-9 text-sm tabular-nums">Q{i + 1}</Label>
                  <select id={`mm-q${i + 1}`} value={m} className="min-h-11 rounded-md border bg-background px-2 text-sm"
                    onChange={(e) => setMarks((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}>
                    <option value="">–</option>
                    {MARKS.map((v) => <option key={v} value={v}>{v === "0.5" ? "½" : v}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === "absent" && <p className="text-base">The student will be shown as absent, with no score or rank.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={entry.isPending}>Cancel</Button>
          <Button type="button" className="min-h-11" onClick={save} disabled={entry.isPending}>
            {entry.isPending ? "Saving" : mode === "absent" ? "Mark absent" : "Save marks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
