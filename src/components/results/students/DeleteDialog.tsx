import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDeleteResults } from "@/hooks/results/useEvaluations";
import { useState } from "react";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; enrollmentIds: string[]; onDone: () => void }

export function DeleteDialog({ open, onOpenChange, enrollmentIds, onDone }: Props) {
  const del = useDeleteResults();
  const [error, setError] = useState<string | null>(null);
  const n = enrollmentIds.length;
  const go = async () => {
    try {
      const done = await del.mutateAsync(enrollmentIds);
      toast.success(`${done} ${done === 1 ? "result" : "results"} deleted. You can restore them for 30 days.`);
      onOpenChange(false);
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setError(null); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {n} {n === 1 ? "result" : "results"}?</DialogTitle>
          <DialogDescription>
            The {n === 1 ? "student goes" : "students go"} back to Pending and ranks are recalculated. You can restore deleted results from the Deleted filter for 30 days.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">Cancel</Button>
          <Button type="button" variant="destructive" onClick={go} disabled={del.isPending} className="min-h-11">
            {del.isPending ? "Deleting" : "Delete result"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
