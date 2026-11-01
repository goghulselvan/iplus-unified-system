import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCorrectAnswer } from "@/hooks/results/useEvaluations";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  evaluationId: string;
  question: number;
  current: string;
  kind: "omr" | "manual";
}

export function CorrectDialog({ open, onOpenChange, evaluationId, question, current, kind }: Props) {
  const correct = useCorrectAnswer();
  const [value, setValue] = useState(current);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setValue(current); setReason(""); setError(null); } }, [open, current]);

  const save = async () => {
    try {
      await correct.mutateAsync({ evaluationId, question, value });
      toast.success(`Q${question} corrected. Score and ranks updated.`);
      onOpenChange(false);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct Q{question}</DialogTitle>
          <DialogDescription>
            {kind === "omr" ? "Type A, B, C or D. Leave it empty for not answered." : "Type 0, 0.5 or 1."} The score and ranks are recalculated straight away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-value" className="text-sm">New {kind === "omr" ? "answer" : "mark"}</Label>
            <Input id="new-value" className="h-11 text-base" value={value} onChange={(e) => setValue(e.target.value)} maxLength={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason" className="text-sm">Why are you changing this? (required)</Label>
            <Textarea id="reason" className="text-base" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">Cancel</Button>
          <Button type="button" onClick={save} disabled={!reason.trim() || correct.isPending} className="min-h-11">
            {correct.isPending ? "Saving" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
