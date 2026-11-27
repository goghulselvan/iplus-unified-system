import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCopySlotPapers, type SlotCopyResult } from "@/hooks/results/useCopySlotPapers";

interface Props { projectId: string; slots: { id: string; slot_name: string }[] }

/**
 * "All slots have the same questions": copies every paper of one slot (questions, answer
 * key, AI check and flag decisions) to the same class and subject on every other slot.
 */
export function CopySlotPapersButton({ projectId, slots }: Props) {
  const api = useCopySlotPapers();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(slots[0]?.id ?? "");
  const [plan, setPlan] = useState<SlotCopyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (slots.length < 2) return null;
  const fromName = slots.find((s) => s.id === from)?.slot_name ?? "";
  const others = slots.filter((s) => s.id !== from).map((s) => s.slot_name).join(", ");

  const check = async (slotId: string) => {
    setBusy(true); setError(null); setPlan(null);
    try { setPlan(await api.check(projectId, slotId)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.run(projectId, from);
      toast.success(`${r.copied} ${r.copied === 1 ? "paper was" : "papers were"} copied from ${fromName}. Uploaded students on those papers are marked again.`);
      setOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const replacing = plan?.items.filter((i) => !i.problem && i.targetQuestions > 0).length ?? 0;
  const copyable = plan?.items.filter((i) => !i.problem).length ?? 0;

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11"
        onClick={() => { setOpen(true); void check(from); }}>
        <Copy className="mr-2 h-4 w-4" aria-hidden="true" /> Same questions for all slots
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Copy papers to every slot</DialogTitle>
            <DialogDescription>
              Every class and subject paper on the slot you pick is copied to the same class and subject on {others || "the other slots"}:
              questions, answer key, AI check and your flag decisions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="copy-from">Copy from</Label>
            <Select value={from} onValueChange={(v) => { setFrom(v); void check(v); }} disabled={busy}>
              <SelectTrigger id="copy-from" className="min-h-11 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{slots.map((s) => <SelectItem key={s.id} value={s.id}>{s.slot_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {busy && !plan && <p role="status" className="text-sm">Checking the papers…</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {plan && plan.items.length === 0 && <p className="text-base">{fromName} has no papers with questions yet. Add them first.</p>}
          {plan && plan.items.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow><TableHead>Class</TableHead><TableHead>Subject</TableHead><TableHead>To</TableHead><TableHead>What happens</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {plan.items.map((i) => (
                    <TableRow key={`${i.classCode}-${i.olympiadCode}-${i.toSlot}`}>
                      <TableCell>{i.className}</TableCell><TableCell>{i.olympiad}</TableCell><TableCell>{i.toSlot}</TableCell>
                      <TableCell>
                        {i.problem ?? (!i.targetExists || i.targetQuestions === 0
                          ? `New paper with ${i.questions} questions`
                          : `Replaces its ${i.targetQuestions} questions${i.targetStudents ? `; ${i.targetStudents} uploaded students are marked again` : ""}`)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {replacing > 0 && (
            <p className="rounded-md border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">
              {replacing} {replacing === 1 ? "paper already has" : "papers already have"} questions on the other slot. They will be replaced with the {fromName} questions.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" className="min-h-11" onClick={run} disabled={busy || copyable === 0}>
              {busy && plan ? "Copying…" : `Copy ${copyable} ${copyable === 1 ? "paper" : "papers"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
